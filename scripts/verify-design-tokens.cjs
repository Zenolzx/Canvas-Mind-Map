/**
 * Design-token guard.
 *
 * The appearance system has one owner per value. Two things can silently break that:
 *
 *  1. A hex value or a raw `font-size` appearing in a component rule instead of in the palette
 *     table, which is how twelve unrelated radii and the ad-hoc HTML type sizes accumulated.
 *  2. The number scales drifting apart. SVG presentation attributes cannot read custom
 *     properties, so `radius`, the depth type ladder and both branch palettes exist twice — once
 *     in TypeScript, once in CSS. They must stay identical, because a divergence means the
 *     export and the screen disagree.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { loadModule } = require('./lib/svg-dom.cjs');

const raw = fs.readFileSync('styles.css', 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split the stylesheet into { selector, body } pairs; at-rule blocks are flattened. */
function rules(text) {
    const out = [];
    const stack = [];
    let buffer = '';
    for (const character of text) {
        if (character === '{') {
            stack.push(buffer.trim()); buffer = '';
        } else if (character === '}') {
            const selector = stack.pop() ?? '';
            if (selector && !selector.startsWith('@')) out.push({ selector, body: buffer });
            buffer = '';
        } else buffer += character;
    }
    return out;
}

const all = rules(css).map(rule => ({ ...rule, selector: rule.selector.replace(/\s+/g, ' ') }));
// The token layers are the rules keyed on an appearance axis; only they may declare a literal.
const isPresetBlock = selector =>
    /data-cmm-appearance|data-cmm-material|data-cmm-typeface|data-cmm-background/.test(selector);

// 1. Hex literals only belong in the palette tables and the scale block.
{
    const offenders = [];
    for (const { selector, body } of all) {
        if (isPresetBlock(selector)) continue;
        for (const match of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
            if (/url\(/.test(body) && /%23/.test(match[0])) continue;
            offenders.push(`${selector} declares ${match[0]}`);
        }
    }
    assert.deepEqual(offenders, [], 'colour literals must live in the palette table, not in a component rule');
}

// 2. Component rules use the type scale rather than raw pixel sizes.
{
    const offenders = [];
    for (const { selector, body } of all) {
        // The scale block itself declares --cmm-font-*; the native heading scale is a separate
        // Obsidian-driven system with its own variables.
        if (selector.includes('--cmm-font') || /--cmm-heading-size|--cmm-font-(2xs|xs|s|m|l|xl)\s*:/.test(body)) continue;
        for (const match of body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) offenders.push(`${selector} uses ${match[1]}px`);
    }
    assert.deepEqual(offenders, [], 'component rules must use --cmm-font-* rather than a raw px size');
}

// 3. Deleted machinery must not come back.
{
    const banned = [
        ['backdrop-filter', 'backdrop blur is only meaningful over a photograph'],
        ['--cmm-art', 'the wallpaper custom property was removed with the photographs'],
        ['cmm-branch-echo', 'the fake-depth connector duplicate was removed'],
        ['data-cmm-appearance="white"', 'the second zero-design preset was removed'],
        ['--cmm-parallax', 'the backdrop offset was removed with the photographs'],
        ['--cmm-control-size', 'the token was never referenced'],
    ];
    for (const [needle, why] of banned) {
        assert.ok(!raw.includes(needle), `styles.css must not contain ${needle}: ${why}`);
    }
}

// 4. Every palette declares the whole token set in both modes.
{
    const required = ['--cmm-paper', '--cmm-paper-rgb', '--cmm-paper-raised', '--cmm-toolbar', '--cmm-ink',
        '--cmm-muted', '--cmm-faint', '--cmm-branch', '--cmm-rule', '--cmm-accent', '--cmm-accent-soft',
        '--cmm-action', '--cmm-action-text', '--cmm-texture'];
    const presets = ['ink', 'cinnabar', 'breeze', 'violet'];
    for (const preset of presets) {
        for (const dark of [false, true]) {
            const prefix = dark ? '.theme-dark ' : '';
            const rule = all.find(({ selector }) => selector.includes(`${prefix}.cmm-organic-view[data-cmm-appearance="${preset}"]`));
            assert.ok(rule, `${preset}${dark ? ' (dark)' : ''} must declare its own token block`);
            for (const token of required) {
                assert.ok(rule.body.includes(`${token}:`), `${preset}${dark ? ' (dark)' : ''} is missing ${token}`);
            }
        }
    }
    // The baseline layer covers the `obsidian` preset, which is "no override" by definition.
    const baseline = all.find(({ selector, body }) => selector.includes('.cmm-organic-view[data-cmm-appearance]')
        && !selector.includes('="') && !selector.includes('theme-dark') && /--cmm-paper:/.test(body));
    assert.ok(baseline, 'the Obsidian-derived baseline layer must exist');
    for (const token of required) assert.ok(baseline.body.includes(`${token}:`), `the baseline layer is missing ${token}`);
}

// 5. TypeScript mirrors. SVG attributes cannot read custom properties, so these are duplicated.
{
    const { RADIUS } = loadModule('src/design/geometry.ts');
    const radiusRule = all.find(({ selector }) => selector.includes('.cmm-organic-view,') && selector.includes('.cmm-composer'));
    assert.ok(radiusRule, 'the radius scale block must exist');
    for (const [name, value] of [['xs', RADIUS.xs], ['s', RADIUS.s], ['m', RADIUS.m], ['l', RADIUS.l]]) {
        assert.ok(radiusRule.body.includes(`--cmm-radius-${name}: ${value}px`),
            `--cmm-radius-${name} must equal RADIUS.${name} (${value}px)`);
    }

    const { BRANCH_PALETTE_DARK, BRANCH_PALETTE_LIGHT } = loadModule('src/design/palette.ts');
    const paletteBlock = dark => all.find(({ selector, body: text }) =>
        /--cmm-branch-1:/.test(text) && (dark ? selector.startsWith('.theme-dark ') : !selector.includes('theme-dark')));
    for (const [label, palette, dark] of [['light', BRANCH_PALETTE_LIGHT, false], ['dark', BRANCH_PALETTE_DARK, true]]) {
        const rule = paletteBlock(dark);
        assert.ok(rule, `the ${label} branch palette block must exist`);
        assert.equal(palette.length, 8, `${label} palette must have eight hues`);
        palette.forEach((colour, index) => {
            assert.ok(rule.body.includes(`--cmm-branch-${index + 1}: ${colour}`),
                `--cmm-branch-${index + 1} (${label}) must equal ${colour} from src/design/palette.ts`);
        });
    }
}

// 6. The bundle may not carry an image payload again: the deleted wallpapers were 32.5 % of it.
{
    if (fs.existsSync('main.js')) {
        const size = fs.statSync('main.js').size;
        assert.ok(size < 760 * 1024,
            `main.js is ${(size / 1024).toFixed(0)} KB; the budget is 760 KB (the removed wallpapers were 352 KB of it)`);
        const base64 = (fs.readFileSync('main.js', 'utf8').match(/data:image\/[a-z]+;base64,/g) ?? []).length;
        // markdown_it ships one matching regex literal; anything beyond that is an inlined asset.
        assert.ok(base64 <= 1, `main.js inlines ${base64} base64 images; only markdown-it's regex literal is expected`);
    }
}

void execFileSync;
console.log('PASS design tokens: single owner per value, palettes complete in both modes, ' +
    'TypeScript scales mirror the CSS, and no inlined image payload');
