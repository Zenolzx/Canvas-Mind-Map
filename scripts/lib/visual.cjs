'use strict';
/**
 * Screenshot regression assertions.
 *
 * The browser suites already produced PNGs, but nothing compared them to anything, so a
 * rendering regression could only be caught by a human opening the file. This turns those
 * captures into assertions.
 *
 * Baselines live in `baselines/` and are committed, so a change to them shows up as a reviewable
 * diff. Decoding uses pngjs as vendored by Playwright, so the tolerance logic adds no dependency.
 *
 * Tolerance: measured on this project against a canonical, re-rendered state, two captures of the
 * same code are byte-identical (0.0000%). Captures taken at the end of a gesture workflow carry
 * pointer-coordinate jitter of up to ~1.7%, and a mid-size real change such as card radius 9->4
 * is itself only ~0.27% — so pixels alone cannot separate those. The default is therefore tight
 * (it catches structural changes such as a missing element, a wrong theme, or a repositioned
 * panel), and gesture-sensitive captures pass an explicit wider band. Property-level regressions
 * that pixels cannot resolve are covered by scripts/verify-render-contract.cjs instead.
 * Raise it with CMM_VISUAL_MAX_DIFF, or re-record with CMM_UPDATE_BASELINES=1.
 */
const fs = require('node:fs');
const path = require('node:path');

const { PNG } = require('playwright-core/lib/utilsBundle');

const BASELINE_DIR = path.resolve('baselines');
const DIFF_DIR = path.resolve('tmp/visual-diffs');

/** Fraction of pixels allowed to differ, and the per-channel delta treated as identical. */
const DEFAULT_MAX_DIFF = Number(process.env.CMM_VISUAL_MAX_DIFF ?? 0.0012);
const CHANNEL_TOLERANCE = Number(process.env.CMM_VISUAL_CHANNEL_TOLERANCE ?? 8);

const decoding = new Set();

function decode(buffer) {
    return PNG.sync.read(buffer);
}

/**
 * Compare two PNG buffers. Returns the differing-pixel count and the total pixel count.
 * A per-channel tolerance avoids flagging sub-visible antialiasing differences.
 */
function compare(expected, actual) {
    const a = decode(expected), b = decode(actual);
    if (a.width !== b.width || a.height !== b.height) {
        return { widthMismatch: true, differing: Infinity, total: a.width * a.height,
            expectedSize: `${a.width}x${a.height}`, actualSize: `${b.width}x${b.height}` };
    }
    const total = a.width * a.height;
    let differing = 0;
    for (let i = 0; i < total; i++) {
        const offset = i * 4;
        if (Math.abs(a.data[offset] - b.data[offset]) > CHANNEL_TOLERANCE ||
            Math.abs(a.data[offset + 1] - b.data[offset + 1]) > CHANNEL_TOLERANCE ||
            Math.abs(a.data[offset + 2] - b.data[offset + 2]) > CHANNEL_TOLERANCE ||
            Math.abs(a.data[offset + 3] - b.data[offset + 3]) > CHANNEL_TOLERANCE) differing++;
    }
    return { widthMismatch: false, differing, total };
}

/** Write a red-highlighted diff, plus the bounding box of the change, so a failure is localizable. */
function writeDiff(name, expected, actual) {
    const a = decode(expected), b = decode(actual);
    if (a.width !== b.width || a.height !== b.height) {
        fs.mkdirSync(DIFF_DIR, { recursive: true });
        fs.writeFileSync(path.join(DIFF_DIR, `${name}-expected.png`), expected);
        fs.writeFileSync(path.join(DIFF_DIR, `${name}-actual.png`), actual);
        return undefined;
    }
    const out = new PNG({ width: a.width, height: a.height });
    let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
    for (let i = 0; i < a.width * a.height; i++) {
        const offset = i * 4;
        const same = Math.abs(a.data[offset] - b.data[offset]) <= CHANNEL_TOLERANCE &&
            Math.abs(a.data[offset + 1] - b.data[offset + 1]) <= CHANNEL_TOLERANCE &&
            Math.abs(a.data[offset + 2] - b.data[offset + 2]) <= CHANNEL_TOLERANCE;
        if (!same) {
            const x = i % a.width, y = Math.floor(i / a.width);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        out.data[offset] = same ? a.data[offset] : 255;
        out.data[offset + 1] = same ? a.data[offset + 1] : 0;
        out.data[offset + 2] = same ? a.data[offset + 2] : 0;
        out.data[offset + 3] = 255;
    }
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIFF_DIR, `${name}.png`), PNG.sync.write(out));
    return maxX < 0 ? undefined : { minX, minY, maxX, maxY };
}

/**
 * Assert a screenshot matches its committed baseline.
 *
 * Set CMM_UPDATE_BASELINES=1 to (re)write the baseline instead of asserting — used when a
 * visual change is intended, so the update is an explicit, reviewable act.
 */
function expectScreenshot(name, buffer, options = {}) {
    const maxDiff = options.maxDiff ?? DEFAULT_MAX_DIFF;
    const baselinePath = path.join(BASELINE_DIR, `${name}.png`);

    if (process.env.CMM_UPDATE_BASELINES === '1') {
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        fs.writeFileSync(baselinePath, buffer);
        console.log(`updated baseline: baselines/${name}.png`);
        return { updated: true };
    }

    if (!fs.existsSync(baselinePath)) {
        // First run on a fresh checkout: record instead of failing, and say so loudly.
        if (decoding.has(name)) return { skipped: true };
        decoding.add(name);
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        fs.writeFileSync(baselinePath, buffer);
        console.log(`SKIP visual "${name}": no baseline existed, wrote baselines/${name}.png. ` +
            'Commit it so the next run can compare.');
        return { created: true };
    }

    const expected = fs.readFileSync(baselinePath);
    const result = compare(expected, buffer);
    if (result.widthMismatch) {
        writeDiff(name, expected, buffer);
        throw new Error(`visual regression "${name}": size changed ${result.expectedSize} -> ${result.actualSize}. ` +
            `Diff written to tmp/visual-diffs/${name}.png. Re-run with CMM_UPDATE_BASELINES=1 if intended.`);
    }
    const fraction = result.differing / result.total;
    if (fraction > maxDiff) {
        const box = writeDiff(name, expected, buffer);
        const where = box ? ` change box x${box.minX}-${box.maxX} y${box.minY}-${box.maxY}` : '';
        throw new Error(`visual regression "${name}": ${result.differing} of ${result.total} pixels differ ` +
            `(${(fraction * 100).toFixed(3)}%, allowed ${(maxDiff * 100).toFixed(3)}%).${where} ` +
            `Diff written to tmp/visual-diffs/${name}.png. Re-run with CMM_UPDATE_BASELINES=1 if intended.`);
    }
    return { differing: result.differing, total: result.total, fraction };
}

module.exports = { expectScreenshot, BASELINE_DIR };
