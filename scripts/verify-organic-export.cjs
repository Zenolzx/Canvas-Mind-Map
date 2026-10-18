const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');

/**
 * Export regression guard.
 *
 * An exported SVG is serialized without any stylesheet, so every rule that dresses the
 * on-screen map has to exist as a presentation attribute. Two defects motivated this test:
 * the branch "echo" under-stroke relied on `.cmm-branch-echo { opacity: .06 }` from
 * styles.css, so exports painted every branch twice at full opacity; and child cards
 * received fill="none" even though on screen they are filled.
 */
function load(entry, globals = {}) {
    const output = esbuild.buildSync({ entryPoints: [entry], bundle: true,
        platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
    const sandbox = { module: { exports: {} }, exports: {}, console, require: name => require(name), ...globals };
    vm.runInNewContext(output.outputFiles[0].text, sandbox);
    return sandbox.module.exports;
}

const { OrganicExportService } = load('src/organic/OrganicExportService.ts',
    { XMLSerializer: class { serializeToString(node) { return serialize(node); } } });

// A minimal DOM: the export service only needs createElementNS and attribute bookkeeping.
const makeDocument = () => {
    const document = {};
    const make = name => {
        const attributes = new Map();
        // `class` is tracked as a set of tokens so `setAttribute('class', …)` and
        // `classList.add(…)` cannot disagree, which is how the DOM behaves.
        const classes = new Set();
        const node = {
            nodeName: name, children: [], parentNode: undefined, ownerDocument: document,
            get attributes() { return [...attributes].map(([n, v]) => ({ name: n, value: v })); },
            setAttribute(n, v) {
                if (n === 'class') { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); return; }
                attributes.set(n, String(v));
            },
            getAttribute(n) { return n === 'class' ? [...classes].join(' ') : attributes.has(n) ? attributes.get(n) : null; },
            removeAttribute(n) { if (n === 'class') classes.clear(); else attributes.delete(n); },
            hasAttribute(n) { return n === 'class' ? classes.size > 0 : attributes.has(n); },
            append(...kids) { for (const kid of kids) { kid.parentNode = node; node.children.push(kid); } },
            insertBefore(kid) { kid.parentNode = node; node.children.unshift(kid); },
            replaceChildren(...kids) { node.children = []; node.append(...kids); },
            remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(c => c !== node); },
            addEventListener() {}, setCssStyles() {},
            get textContent() { return node.children.map(c => c.textContent ?? '').join(''); },
            set textContent(value) { node.children = [{ textContent: String(value), children: [], parentNode: node }]; },
            _attrs: attributes, _classes: classes,
            querySelectorAll(selector) { return descendants(node).filter(el => matches(el, selector)); },
            querySelector(selector) { return node.querySelectorAll(selector)[0] ?? null; },
        };
        node.classList = {
            add: (...names) => names.forEach(n => classes.add(n)),
            remove: (...names) => names.forEach(n => classes.delete(n)),
            contains: name => classes.has(name),
            toggle: (name, force) => { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
        };
        return node;
    };
    const descendants = node => node.children.flatMap(child => child.children ? [child, ...descendants(child)] : []);
    const matchesCompound = (el, selector) => {
        if (selector.startsWith('.')) return el._classes?.has(selector.slice(1));
        if (selector.startsWith('[') && selector.endsWith(']')) {
            const attribute = selector.slice(1, -1);
            return el._attrs?.has(attribute);
        }
        return el.nodeName === selector;
    };
    const ancestors = el => { const chain = []; let current = el.parentNode; while (current) { chain.push(current); current = current.parentNode; } return chain; };
    // Supports the descendant combinator (`a b`) as well as a simple selector, so the
    // tests can query the same way the production code does.
    const matches = (el, selector) => {
        const parts = selector.trim().split(/\s+/);
        if (!matchesCompound(el, parts[parts.length - 1])) return false;
        let chain = ancestors(el);
        for (let i = parts.length - 2; i >= 0; i--) {
            const index = chain.findIndex(candidate => matchesCompound(candidate, parts[i]));
            if (index < 0) return false;
            chain = chain.slice(index + 1);
        }
        return true;
    };
    document.createElementNS = (_ns, name) => make(name);
    document.defaultView = undefined;
    return document;
};
const serialize = svg => {
    const walk = node => {
        if (!node.nodeName) return node.textContent ?? '';
        const attrs = (node.attributes ?? []).map(({ name, value }) => ` ${name}="${value}"`).join('');
        const classes = node._classes?.size ? ` class="${[...node._classes].join(' ')}"` : '';
        const inner = (node.children ?? []).map(walk).join('');
        return `<${node.nodeName}${classes}${attrs}>${inner}</${node.nodeName}>`;
    };
    return walk(svg);
};

const result = {
    nodes: [
        { id: 'r', title: 'Root', x: -60, y: -20, width: 120, height: 40, depth: 0, rootBranchId: 'r',
            direction: 0, fontSize: 30, fontWeight: 650, color: 'var(--cmm-ink)', lines: ['Root'], children: 1, collapsed: false },
        { id: 'a', title: 'Child', x: 200, y: -15, width: 110, height: 30, depth: 1, rootBranchId: 'a',
            direction: 0, fontSize: 21, fontWeight: 650, color: 'var(--cmm-branch-2)', lines: ['Child'], children: 0, collapsed: false },
    ],
    branches: [{ parentId: 'r', childId: 'a', start: { x: 60, y: 0 }, control1: { x: 120, y: 0 },
        control2: { x: 150, y: 0 }, end: { x: 200, y: 0 }, width: 4.2, color: 'var(--cmm-branch-2)' }],
    bounds: { x: -108, y: -68, width: 466, height: 136 },
};

globalThis.XMLSerializer = class { serializeToString(node) { return serialize(node); } };
const document = makeDocument();
const svg = new OrganicExportService().svg(document, result, {
    background: '#ffffff', foreground: '#102020', border: '#cccccc', rootBackground: '#f2f2f2',
    nodeBackground: '#fbfbfb', branch: '#336655', muted: '#203030',
    accent: '#0a84ff', highlight: '#ffe9a8', fontFamily: 'Inter',
    // The renderer writes design tokens so a theme switch needs no relayout; the export has no
    // stylesheet, so it must substitute the values the live view computed. Parsing the name out of
    // the declaration mirrors what the view does with getComputedStyle.
    resolve: declaration => {
        const name = /var\(\s*(--[A-Za-z0-9-]+)/.exec(declaration)?.[1] ?? '';
        return ({ '--cmm-ink': '#102020', '--cmm-muted': '#203030', '--cmm-rule': '#cccccc',
            '--cmm-paper': '#ffffff', '--cmm-branch-2': '#336655' })[name] ?? '#888888';
    },
});

assert.ok(!/<style/.test(svg), 'export must not depend on a stylesheet');

// One tapered stroke per branch. The fake-depth echo is gone, so an export can no longer paint
// every connector twice.
const paths = svg.match(/<path[^>]*>/g) ?? [];
assert.ok(!/cmm-branch-echo/.test(svg), 'the branch echo no longer exists in the export');
const solid = paths.filter(p => /data-child-id=/.test(p));
assert.equal(solid.length, 1, 'exactly one stroke per branch');
assert.ok(/opacity="0\.88"/.test(solid[0]), 'the branch stroke matches the on-screen branch opacity');
if (process.env.CMM_EXPORT_PROBE) console.log(svg);
assert.ok(/stroke="#336655"/.test(solid[0]), 'the per-branch token is substituted with a real colour');

// Cards are flat ink on paper: filled, borderless, and the root is a sheet header. The radius is
// the surface's own value rather than a hardcoded 9.
const rects = svg.match(/<rect[^>]*>/g) ?? [];
const cards = rects.filter(r => r.includes('cmm-organic-hitbox'));
assert.equal(cards.length, 2, 'one card rect per node');
assert.ok(cards.every(r => /stroke="none"/.test(r)), 'no card carries a visible border');
assert.ok(cards.every(r => /stroke-width="0"/.test(r)), 'the stroke width is an attribute even at zero');
assert.ok(/rx="9"/.test(cards[0]), 'cards carry the surface radius instead of relying on CSS');
assert.ok(/fill="none"/.test(cards[0]), 'the root card is not a box');
assert.match(svg, /class="cmm-organic-head-rule"/, 'the root head rule survives the export');
assert.match(svg, /<line[^>]*stroke="#cccccc"/, 'the head rule colour is substituted, not left as a token');

// Labels are always the darkest ink, in the export as on screen; hue never reaches the text.
assert.ok(/fill="#102020"/.test(svg), 'labels use the resolved ink colour');
assert.ok(!/<text[^>]*fill="#203030"/.test(svg), 'no card label falls back to the muted colour');
assert.ok(/<svg[^>]*font-family="Inter, /.test(svg), 'the root element carries the resolved font family');
assert.ok(!/var\(--/.test(svg), 'no custom property reference may survive into the exported file');

console.log('PASS export: single tapered connector, borderless cards, root sheet header, token substitution and fonts resolved without CSS');
