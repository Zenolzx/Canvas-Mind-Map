// Pure layout regressions; no Obsidian runtime or user files required.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const output = esbuild.buildSync({ entryPoints: ['src/MindmapModel.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const sandbox = { exports: {}, module: { exports: {} }, require };
vm.runInNewContext(output.outputFiles[0].text, sandbox);
const { placeNodes, layoutFocusedSubtree, meta, hiddenNodes, descendants, overlaps, treeEdge } = sandbox.module.exports;

function node(id, parentId, depth, expanded = false) {
    return { id, type: 'text', text: id, x: 0, y: 0, width: 250 + depth * 25, height: 70 + depth * 10,
        canvasMindMap: { version: 1, nodeId: id, rootId: 'root', parentId, depth, expanded,
            key: id, title: id, angle: 0, placed: false, mode: 'title', style: {}, applied: {} } };
}
function fixture(layout) {
    const root = node('root', undefined, 0, true);
    meta(root).layout = layout;
    const nodes = [root];
    for (let i = 0; i < 8; i++) {
        const branch = node(`b${i}`, 'root', 1);
        nodes.push(branch);
        for (let j = 0; j < (i % 4 + 2); j++) {
            const child = node(`b${i}c${j}`, branch.id, 2, true);
            nodes.push(child);
            for (let k = 0; k < j % 3; k++) nodes.push(node(`${child.id}d${k}`, child.id, 3));
        }
    }
    return { nodes, edges: nodes.slice(1).map(n => treeEdge(`e${n.id}`, 'root', meta(n).parentId, n.id)) };
}
const pos = n => [n.x, n.y];
function validate(data, layout, fullLayout = false) {
    const hidden = hiddenNodes(data.nodes), visible = data.nodes.filter(n => !hidden.has(n.id));
    const vertical = ['vertical', 'up', 'down'].includes(layout);
    const main = n => vertical ? n.y + n.height / 2 : n.x + n.width / 2;
    const crossStart = n => vertical ? n.x : n.y;
    const crossEnd = n => crossStart(n) + (vertical ? n.width : n.height);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++)
        assert.ok(!overlaps(visible[i], visible[j], 0), `${layout}: overlap ${visible[i].id}/${visible[j].id}`);
    const root = visible[0];
    for (const parent of visible) {
        const children = visible.filter(n => meta(n).parentId === parent.id);
        const groups = new Map();
        for (const child of children) {
            const side = Math.sign(main(child) - main(root));
            assert.ok(side * (main(child) - main(parent)) > 0, `${layout}: backwards edge ${parent.id}/${child.id}`);
            const branch = [child, ...descendants(visible, child.id)];
            const interval = [Math.min(...branch.map(crossStart)), Math.max(...branch.map(crossEnd))];
            const previous = groups.get(side);
            // Local expansion keeps neighbouring branches fixed, so cross-axis
            // extents may overlap after outward obstacle avoidance. Global lane
            // separation is a full-relayout contract, not a local-edit contract.
            if (fullLayout) assert.ok(!previous || previous[1] < interval[0], `${layout}: crossing subtree lanes at ${child.id}`);
            groups.set(side, interval);
        }
    }
}
for (const layout of ['horizontal', 'vertical', 'left', 'right', 'up', 'down']) {
    const data = fixture(layout);
    placeNodes(data, 'root', new Set(data.nodes.slice(1).map(n => n.id)));
    validate(data, layout, true);
    for (const id of ['b3', 'b1', 'b6', 'b4']) {
        const anchor = data.nodes.find(n => n.id === id);
        anchor.x += 0.25; anchor.y += 0.75;
        const before = pos(anchor), rootBefore = pos(data.nodes[0]);
        const branchIds = new Set([id, ...descendants(data.nodes, id).map(n => n.id)]);
        const outside = data.nodes.filter(n => !branchIds.has(n.id)).map(n => [n.id, pos(n)]);
        const oldHidden = hiddenNodes(data.nodes);
        meta(anchor).expanded = true;
        const hidden = hiddenNodes(data.nodes);
        const revealed = new Set([...oldHidden].filter(id => !hidden.has(id)));
        placeNodes(data, 'root', revealed, id);
        assert.deepEqual(pos(anchor), before, `${layout}: anchor moved`);
        assert.deepEqual(pos(data.nodes[0]), rootBefore, `${layout}: root moved`);
        for (const [id, position] of outside) assert.deepEqual(pos(data.nodes.find(n => n.id === id)), position, `${layout}: another branch moved`);
        validate(data, layout);
        const growing = data.nodes.find(n => n.id === `${id}c0`);
        growing.height = 580;
        placeNodes(data, 'root', new Set([growing.id]), id);
        assert.deepEqual(pos(anchor), before, `${layout}: height adjustment moved anchor`);
        validate(data, layout);
        meta(anchor).expanded = false;
        placeNodes(data, 'root', new Set(), id);
        assert.deepEqual(pos(anchor), before, `${layout}: collapse moved anchor`);
        validate(data, layout);
    }
    // Reopening a nested branch keeps the clicked child fixed too.
    const parent = data.nodes.find(n => n.id === 'b3');
    meta(parent).expanded = true;
    const nested = data.nodes.find(n => n.id === 'b3c1');
    meta(nested).expanded = false;
    placeNodes(data, 'root', new Set(descendants(data.nodes, parent.id).map(n => n.id)), parent.id);
    const before = pos(nested);
    meta(nested).expanded = true;
    placeNodes(data, 'root', new Set(descendants(data.nodes, nested.id).map(n => n.id)), nested.id);
    assert.deepEqual(pos(nested), before, `${layout}: nested anchor moved`);
    validate(data, layout);
}
console.log('PASS: six directional layouts, expand/collapse, subtree lanes, auto-height, stable anchors and root.');

for (const layout of ['radial', 'horizontal', 'vertical', 'left', 'right', 'up', 'down']) {
    const data = fixture(layout);
    for (const entry of data.nodes) meta(entry).expanded = true;
    if (layout === 'radial') {
        const { assignAngles } = sandbox.module.exports;
        assignAngles(data.nodes, 'root');
    }
    placeNodes(data, 'root', new Set(data.nodes.slice(1).map(n => n.id)));
    const focus = data.nodes.find(n => n.id === 'b3');
    const before = pos(focus);
    const descendantsBefore = descendants(data.nodes, focus.id).map(n => [n.id, ...pos(n)]);
    const moved = layoutFocusedSubtree(data, { focusId: focus.id, mode: 'hide' });
    assert.deepEqual(pos(focus), before, `${layout}: focused anchor moved`);
    assert.ok(moved.size > 0, `${layout}: no focused descendants moved`);
    const changed = descendantsBefore.some(([id, x, y]) => {
        const current = data.nodes.find(n => n.id === id);
        return current.x !== x || current.y !== y;
    });
    if (layout === 'radial') assert.ok(changed, 'radial: focused projection retained the old narrow sector');
    const visible = [focus, ...descendants(data.nodes, focus.id)].filter(n => !hiddenNodes(data.nodes).has(n.id));
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++)
        assert.ok(!overlaps(visible[i], visible[j], 0), `${layout}: focused overlap ${visible[i].id}/${visible[j].id}`);

    const centered = fixture(layout);
    for (const entry of centered.nodes) meta(entry).expanded = true;
    if (layout === 'radial') sandbox.module.exports.assignAngles(centered.nodes, 'root');
    placeNodes(centered, 'root', new Set(centered.nodes.slice(1).map(n => n.id)));
    const rootBefore = pos(centered.nodes[0]);
    layoutFocusedSubtree(centered, { focusId: 'root', mode: 'hide' });
    assert.deepEqual(pos(centered.nodes[0]), rootBefore, `${layout}: centered focus moved the root`);
    for (let i = 0; i < centered.nodes.length; i++) for (let j = i + 1; j < centered.nodes.length; j++)
        assert.ok(!overlaps(centered.nodes[i], centered.nodes[j], 0), `${layout}: centered focus overlap ${centered.nodes[i].id}/${centered.nodes[j].id}`);
}
console.log('PASS: branch and center focus projections for all seven layouts, stable anchors and no subtree overlaps.');

{
    const hiddenProjection = fixture('right');
    for (const entry of hiddenProjection.nodes) meta(entry).expanded = true;
    placeNodes(hiddenProjection, 'root', new Set(hiddenProjection.nodes.slice(1).map(n => n.id)));
    layoutFocusedSubtree(hiddenProjection, { focusId: 'b3', mode: 'hide' });
    const target = hiddenProjection.nodes.find(n => n.id === 'b3c0');
    const dimProjection = fixture('right');
    for (const entry of dimProjection.nodes) meta(entry).expanded = true;
    placeNodes(dimProjection, 'root', new Set(dimProjection.nodes.slice(1).map(n => n.id)));
    const obstacle = dimProjection.nodes.find(n => n.id === 'b4');
    obstacle.x = target.x; obstacle.y = target.y;
    layoutFocusedSubtree(dimProjection, { focusId: 'b3', mode: 'dim' });
    assert.ok(!overlaps(dimProjection.nodes.find(n => n.id === 'b3c0'), obstacle), 'dim focus overlaps a background card');
}
console.log('PASS: dim focus avoids visible background cards.');

const i18nOutput = esbuild.buildSync({ entryPoints: ['src/i18n.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const i18nSandbox = { exports: {}, module: { exports: {} }, require };
vm.runInNewContext(i18nOutput.outputFiles[0].text, i18nSandbox);
const { setLanguage, t } = i18nSandbox.module.exports;
setLanguage('auto', 'zh-CN');
assert.equal(t('中心'), '中心', 'Simplified Chinese auto locale');
setLanguage('auto', 'zh-TW');
assert.equal(t('中心'), 'Central Topic', 'unsupported locale falls back to English');
assert.equal(t('移除 {count} 个旧节点', { count: 3 }), 'Remove 3 old nodes', 'English interpolation');
console.log('PASS: automatic language selection and translated interpolation.');

// Exercise reading state and persistence with a small Canvas/DOM double.
const featureOutput = esbuild.buildSync({ entryPoints: ['src/CanvasMindmap.ts'], bundle: true,
    platform: 'node', format: 'cjs', external: ['obsidian', 'monkey-around'], write: false });
const featureSandbox = { module: { exports: {} }, exports: {}, console,
    require: name => name === 'obsidian' ? { FuzzySuggestModal: class {}, Notice: class {} } : {} };
vm.runInNewContext(featureOutput.outputFiles[0].text, featureSandbox);
class Element {
    constructor() {
        this.children = []; this.isConnected = true;
        const classes = new Set();
        this.classList = { toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
            remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) };
        this.ownerDocument = { defaultView: null, createElement: () => new Element() };
    }
    querySelector(selector) { return this.children.find(child => selector === `.${child.className}`) ?? null; }
    appendChild(child) { this.children.push(child); return child; }
    createDiv() { return this.appendChild(new Element()); }
    createSpan() { return this.appendChild(new Element()); }
    createEl() { return this.appendChild(new Element()); }
    addEventListener() {}
    appendText() {}
    setAttribute() {}
    removeAttribute() {}
    remove() { this.isConnected = false; }
}
function canvasDouble(data) {
    const canvas = { data, nodes: new Map(), edges: new Map(), selection: new Set(), readonly: false,
        viewport: { x: 40, y: 80, zoom: -0.4 }, view: { containerEl: new Element() },
        getData() { return this.data; }, getState() { return { ...this.viewport }; },
        setViewport(x, y, zoom) { this.viewport = { x, y, zoom }; },
        deselectAll() { this.selection.clear(); }, select(node) { this.selection.add(node); },
        deselect(node) { this.selection.delete(node); }, zoomToSelection() { this.viewport = { x: 500, y: 500, zoom: -1 }; },
        requestSave() {}, importData(data) { this.setData(data); },
        setData(data) {
            this.data = data;
            const nodes = new Map();
            for (const entry of data.nodes) {
                const old = this.nodes.get(entry.id);
                const node = old ?? { nodeEl: new Element(), canvas: this, getData() { return this.data; } };
                Object.assign(node, { ...entry, data: entry }); nodes.set(entry.id, node);
            }
            this.nodes = nodes;
        } };
    canvas.setData(data); return canvas;
}
const plugin = { settings: { focusMode: 'hide', compactFocus: true }, saveSettings: async () => {} };
const feature = new featureSandbox.module.exports.CanvasMindmap(plugin);
const canvas = canvasDouble(fixture('right'));
placeNodes(canvas.data, 'root', new Set(canvas.data.nodes.map(n => n.id)));
canvas.setData(canvas.data);
canvas.select(canvas.nodes.get('b3'));
const originalViewport = { ...canvas.viewport };
const originalPositions = new Map(canvas.data.nodes.map(n => [n.id, pos(n)]));
feature.focusBranch(canvas, 'b3');
assert.ok(feature.displayState(canvas, canvas.data).hidden.has('b1'), 'focus hides other branches');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('root'), 'focus keeps ancestor path');
feature.fold(canvas, 'b3', true);
assert.equal(meta(canvas.nodes.get('b3').getData()).expanded, false, 'focus expansion must not persist');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('b3c0'), 'focus expansion is visible');
feature.exitFocus(canvas);
assert.deepEqual(canvas.viewport, originalViewport, 'exit restores exact viewport');
for (const entry of canvas.data.nodes) assert.deepEqual(pos(entry), originalPositions.get(entry.id), `exit restores ${entry.id} position`);
assert.ok(feature.displayState(canvas, canvas.data).hidden.has('b3c0'), 'exit restores folds');
assert.ok(canvas.selection.has(canvas.nodes.get('b3')), 'exit restores selection');
plugin.settings.focusMode = 'dim';
feature.focusBranch(canvas, 'b3');
assert.ok(feature.displayState(canvas, canvas.data).dim.has('b1'), 'dim mode retains context');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('b1'), 'dim mode does not hide expanded context');
feature.revealResult(canvas, 'b3c1d0');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('b3c1d0'), 'search expands complete path');
assert.equal([...canvas.selection][0].id, 'b3c1d0', 'search selects result');
assert.equal(feature.reading.has(canvas), false, 'search exits focus before revealing elsewhere');
const second = canvasDouble(fixture('left'));
feature.focusBranch(second, 'b1');
assert.equal(feature.reading.has(canvas), false, 'focus is isolated per canvas');
feature.clearDisplay(second);
assert.equal(feature.reading.has(second), false, 'cleanup releases focus');
console.log('PASS: focus hide/dim, ancestor context, temporary folding, viewport/selection restore, folded search result.');
