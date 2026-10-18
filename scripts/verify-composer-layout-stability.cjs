/**
 * Layout stability under a one-node edit.
 *
 * Composer re-lays out on every render. The engine assigns each top-level branch a side (and a
 * palette colour) from complete-subtree weights, so with no memory of the previous assignment a
 * single new child reorders those weights and mirrors whole branches across the root. The view
 * then pins one anchor and translates the scene to compensate, which is what threw the map off
 * screen on every Enter.
 *
 * Pass one: the projection carries the full tree for weighting, and `branchStyles` is carried
 * between layouts. Pass two is the control — the same edit without that memory — which is why the
 * wiring is asserted directly at the end of this file.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const esbuild = require('esbuild');

function load(entry) {
    const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
    const module = { exports: {} };
    new Function('module', 'exports', out.outputFiles[0].text)(module, module.exports);
    return module.exports;
}

const { newDraft, newNode } = load('src/composer/ComposerModel.ts');
const { composerProjection } = load('src/composer/ComposerTools.ts');
const { OrganicLayoutEngine } = load('src/organic/OrganicLayoutEngine.ts');

const engine = new OrganicLayoutEngine();
const measureText = (text, size) => Array.from(text).length * size * 0.6;

/** Mirrors the option set ComposerView.render() passes, including the two memory fields. */
function options(projection, branchStyles) {
    return {
        style: 'organic-radial', fontScale: 0.8, branchWidth: 1.8,
        collapsed: projection.collapsed, branchStyles, referenceModel: projection.reference, measureText,
    };
}

const draft = newDraft();
draft.layout = 'organic-radial';
for (const title of ['Process', 'Memory', 'Storage']) {
    const section = newNode(title);
    section.children.push(newNode(`${title} detail`));
    draft.root.children.push(section);
}

const before = composerProjection(draft);
const first = engine.layout(before.model, options(before, Object.create(null)));

// The edit: one empty child on the first section, exactly what `add(true)` inserts.
draft.root.children[0].children.push(newNode(''));
const after = composerProjection(draft);
const stable = engine.layout(after.model, options(after, first.branchStyles));
const control = engine.layout(after.model, options(after, Object.create(null)));

const centre = nodes => {
    const root = nodes.find(node => node.depth === 0);
    return new Map(nodes.map(node => [node.id, { x: node.x + node.width / 2, rootX: root.x + root.width / 2, title: node.title }]));
};
const previous = centre(first.nodes), current = centre(stable.nodes);

let worstStable = 0;
for (const [id, old] of previous) {
    const now = current.get(id);
    assert.ok(now, `node ${old.title} disappeared`);
    if (old.title === draft.root.title) continue;
    assert.equal(Math.sign(old.x - old.rootX) || 0, Math.sign(now.x - now.rootX) || 0,
        `${old.title} moved to the other side of the root`);
    const dx = now.x - old.x;
    const oldNode = first.nodes.find(node => node.id === id), nowNode = stable.nodes.find(node => node.id === id);
    assert.ok(nowNode, `missing geometry for ${old.title}`);
    worstStable = Math.max(worstStable, Math.hypot(dx, nowNode.y - oldNode.y));
}
// A new sibling legitimately pushes its neighbours a little; a hemisphere flip moves hundreds.
assert.ok(worstStable < 40, `carried assignment still moved a node ${worstStable.toFixed(1)} units`);

// The control must actually be bad, otherwise this file proves nothing.
const controlNodes = centre(control.nodes);
let worstControl = 0;
for (const [id, old] of previous) {
    const now = controlNodes.get(id);
    if (!now) continue;
    const oldNode = first.nodes.find(node => node.id === id), nowNode = control.nodes.find(node => node.id === id);
    worstControl = Math.max(worstControl, Math.hypot(now.x - old.x, nowNode.y - oldNode.y));
}
assert.ok(worstControl > 100,
    `the stateless layout was expected to displace branches by >100 units, measured ${worstControl.toFixed(1)}`);

// Sides and colours are the identity that has to survive, so assert them explicitly.
for (const id of Object.keys(first.branchStyles ?? {})) {
    assert.deepEqual(stable.branchStyles[id], first.branchStyles[id], `branch style for ${id} changed`);
}

// A sticky side changes which group a branch is packed into, so the pack still has to hold.
for (const [label, result] of [['before', first], ['after', stable]]) {
    const nodes = result.nodes;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        assert.ok(!(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height),
            `${label}: ${a.title} overlaps ${b.title}`);
    }
}

// The engine cannot enforce its own wiring: a caller that forgets the memory is indistinguishable
// from one that has none. Guard the call site, because that omission is the bug that shipped.
const source = fs.readFileSync('src/composer/ComposerView.ts', 'utf8');
const call = source.indexOf('this.engine.layout(');
assert.ok(call >= 0, 'ComposerView no longer lays out through the engine');
const site = source.slice(call, source.indexOf('measureText', call) + 400);
assert.match(site, /branchStyles:\s*this\.branchStyles/, 'ComposerView must carry branchStyles into the layout');
assert.match(site, /referenceModel:\s*projection\.reference/, 'ComposerView must weight the full tree, not the filtered projection');

const guard = source.slice(source.indexOf('private ensureVisible('));
assert.match(guard.slice(0, 1400), /width <= 0/,
    'ensureVisible must refuse to compute a pan from an unmeasured pane');

console.log(`PASS composer layout stability: worst displacement ${worstStable.toFixed(1)} units with the carried assignment, ${worstControl.toFixed(1)} without`);
