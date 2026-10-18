const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Translation dictionary guard.
 *
 * `t()` falls back to returning its own key, so a missing entry renders a Chinese
 * sentence to an English user instead of failing. That is how the Writing and DOCX
 * surfaces ended up Chinese-only in the `en` locale. This check fails the suite when a
 * literal key has no dictionary entry, so the gap cannot reappear silently.
 */

const read = file => fs.readFileSync(file, 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
});

/** Keys of a `{ 'key': 'value', … }` object literal, read line by line.
 *  Parsing line starts (rather than the whole file) avoids mistaking `t('…')` call sites
 *  inside a function body for dictionary entries. */
const dictionaryKeys = (file, marker) => {
    const lines = read(file).split(/\r?\n/);
    const start = lines.findIndex(line => line.includes(marker));
    assert.ok(start >= 0, `${file} does not contain ${marker}`);
    const keys = new Set();
    let depth = 0, opened = false;
    for (const line of lines.slice(start)) {
        if (!opened) { if (!/\{/.test(line)) continue; opened = true; depth = 1; continue; }
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0) break;
        // One line may declare several entries, so collect every quoted key on the line.
        for (const match of line.matchAll(/'((?:[^'\\]|\\.)+)'\s*:/g)) keys.add(match[1]);
    }
    return keys;
};

const enKeys = dictionaryKeys('src/i18n.ts', 'const EN: Record<string, string> = {');
assert.ok(enKeys.size > 100, `expected a populated dictionary, found ${enKeys.size} keys`);

// ct() resolves English labels through COMPOSER_ZH, whose values are the Chinese t() keys.
const composerZh = dictionaryKeys('src/composer/ComposerStrings.ts', 'COMPOSER_ZH');
assert.ok(composerZh.size > 50, `expected a populated Composer map, found ${composerZh.size} keys`);

const unresolved = [];
for (const file of walk('src').concat('main.ts')) {
    const source = read(file);
    // t('literal') / ct('literal') with a single-quoted, interpolation-free argument.
    for (const match of source.matchAll(/\b(?:t|ct)\(\s*'((?:[^'\\]|\\.)+)'/g)) {
        const key = match[1];
        // Non-ASCII keys are dictionary keys; ASCII keys routed through ct() are too.
        if (/[\u3400-\u9fff]/.test(key)) {
            if (!enKeys.has(key)) unresolved.push({ file, key, via: 't' });
        } else if (!composerZh.has(key)) {
            unresolved.push({ file, key, via: 'ct' });
        }
    }
}

// `t()` is also called with runtime-computed keys; those cannot be checked statically and
// are listed here for visibility rather than asserted.
const dynamic = [];
for (const file of walk('src').concat('main.ts')) {
    const source = read(file);
    for (const match of source.matchAll(/\b(?:t|ct)\(\s*(?!')([^)\n]{0,60})/g)) dynamic.push({ file, expression: match[1].trim() });
}

if (unresolved.length) {
    console.error(`FAIL: ${unresolved.length} literal translation key(s) missing from the dictionary:`);
    for (const item of unresolved) console.error(`  ${item.file}  ${item.via}('${item.key}')`);
    process.exit(1);
}

console.log(`PASS i18n: ${enKeys.size} dictionary keys cover every literal t()/ct() call ` +
    `(${dynamic.length} runtime-computed keys are checked at runtime only)`);
