'use strict';
/**
 * Shared browser-tooling resolver for the real-browser suites.
 *
 * These suites used to hard-code one developer machine's Playwright cache and Edge install,
 * so they could only ever run on that machine and never in CI. Resolution is now:
 *
 *   Playwright module:  CMM_PLAYWRIGHT  ->  local node_modules  ->  legacy cache path
 *   Browser executable: CMM_BROWSER     ->  Playwright's own Chromium  ->  system Chrome/Edge
 *
 * `describe()` never throws: callers decide whether missing tooling is fatal (CI) or a skip.
 * Set CMM_REQUIRE_BROWSER=1 to turn a missing browser into a hard failure.
 */
const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_BROWSERS = [
    // Windows
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
];

function resolvePlaywright() {
    const candidates = [];
    if (process.env.CMM_PLAYWRIGHT) candidates.push(process.env.CMM_PLAYWRIGHT);
    candidates.push('playwright', 'playwright-core');
    // Legacy location used before Playwright was a declared dependency. Kept last so an
    // installed dependency always wins over a stale cache.
    candidates.push(path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache',
        'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));

    for (const candidate of candidates) {
        if (!candidate) continue;
        try { return { module: require(candidate), source: candidate }; } catch { /* try next */ }
    }
    return { module: undefined, source: undefined };
}

function resolveBrowser(chromium) {
    if (process.env.CMM_BROWSER) {
        return fs.existsSync(process.env.CMM_BROWSER)
            ? { executablePath: process.env.CMM_BROWSER, source: 'CMM_BROWSER' }
            : { executablePath: undefined, source: undefined, reason: `CMM_BROWSER points at a missing file: ${process.env.CMM_BROWSER}` };
    }
    for (const candidate of SYSTEM_BROWSERS) {
        if (fs.existsSync(candidate)) return { executablePath: candidate, source: candidate };
    }
    // Playwright's own Chromium is only usable if it has actually been downloaded.
    let managed;
    try { managed = chromium?.executablePath?.(); } catch { managed = undefined; }
    if (managed && fs.existsSync(managed)) {
        return { executablePath: undefined, source: `playwright-managed (${path.basename(managed)})` };
    }
    return { executablePath: undefined, source: undefined };
}

/** Never throws. Returns a description the caller can act on or report. */
function describe() {
    const { module, source } = resolvePlaywright();
    if (!module) {
        return { available: false, reason: 'the playwright module could not be resolved',
            hint: 'Run `npm install` (playwright is a devDependency), or set CMM_PLAYWRIGHT to a playwright install.' };
    }
    const { executablePath, source: browserSource, reason } = resolveBrowser(module.chromium);
    if (!browserSource) {
        return { available: false, reason: reason ?? 'no Chromium-based browser could be located',
            hint: 'Run `npx playwright install chromium`, or set CMM_BROWSER to a Chrome/Edge executable.' };
    }
    return { available: true, chromium: module.chromium, executablePath, playwright: source, browser: browserSource };
}

/** Launch options shared by every suite, so all of them agree on the executable. */
function launchOptions(extra = {}) {
    const tooling = describe();
    const options = { headless: true, ...extra };
    if (tooling.available && tooling.executablePath) options.executablePath = tooling.executablePath;
    return options;
}

/**
 * Exit the process when browser tooling is unavailable. In CI (CMM_REQUIRE_BROWSER=1 or
 * CI=true) this is a failure; locally it is a clearly-labelled skip so a contributor without
 * Playwright is not blocked on the unit suites.
 */
function requireTooling(suiteName) {
    const tooling = describe();
    if (tooling.available) return tooling;
    const required = process.env.CMM_REQUIRE_BROWSER === '1' || process.env.CI === 'true';
    const message = `${suiteName}: ${tooling.reason}.\n  ${tooling.hint}`;
    if (required) {
        console.error(`FAIL ${message}`);
        process.exit(1);
    }
    console.warn(`SKIP ${message}`);
    process.exit(0);
}

/**
 * Resolve the Playwright module for the CDP-attaching suites. These connect to an already
 * running Obsidian (`chromium.connectOverCDP`), so no browser executable is needed.
 */
function requirePlaywright(suiteName) {
    const { module } = resolvePlaywright();
    if (module?.chromium) return module.chromium;
    const hint = 'Run `npm install` (playwright is a devDependency), or set CMM_PLAYWRIGHT to a playwright install.';
    const required = process.env.CMM_REQUIRE_BROWSER === '1' || process.env.CI === 'true';
    if (required) {
        console.error(`FAIL ${suiteName}: playwright could not be resolved.\n  ${hint}`);
        process.exit(1);
    }
    console.warn(`SKIP ${suiteName}: playwright could not be resolved.\n  ${hint}`);
    process.exit(0);
}

module.exports = { describe, launchOptions, requireTooling, requirePlaywright };
