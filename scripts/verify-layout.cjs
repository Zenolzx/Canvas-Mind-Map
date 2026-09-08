// Pure layout regressions; no Obsidian runtime or user files required.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const output = esbuild.buildSync({ entryPoints: ['src/MindmapModel.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const sandbox = { exports: {}, module: { exports: {} }, require };
vm.runInNewContext(output.outputFiles[0].text, sandbox);
const { placeNodes, meta, hiddenNodes, descendants, overlaps, treeEdge } = sandbox.module.exports;

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
function validate(data, layout) {
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
            assert.ok(!previous || previous[1] < interval[0], `${layout}: crossing subtree lanes at ${child.id}`);
            groups.set(side, interval);
        }
    }
}
for (const layout of ['horizontal', 'vertical', 'left', 'right', 'up', 'down']) {
    const data = fixture(layout);
    placeNodes(data, 'root', new Set(data.nodes.slice(1).map(n => n.id)));
    validate(data, layout);
    for (const id of ['b3', 'b1', 'b6', 'b4']) {
        const anchor = data.nodes.find(n => n.id === id);
        anchor.x += 0.25; anchor.y += 0.75;
        const before = pos(anchor), rootBefore = pos(data.nodes[0]);
        const oldHidden = hiddenNodes(data.nodes);
        meta(anchor).expanded = true;
        const hidden = hiddenNodes(data.nodes);
        const revealed = new Set([...oldHidden].filter(id => !hidden.has(id)));
        placeNodes(data, 'root', revealed, id);
        assert.deepEqual(pos(anchor), before, `${layout}: anchor moved`);
        assert.deepEqual(pos(data.nodes[0]), rootBefore, `${layout}: root moved`);
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
    setAttribute() {}
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
const plugin = { settings: { focusMode: 'hide' }, saveSettings: async () => {} };
const feature = new featureSandbox.module.exports.CanvasMindmap(plugin);
const canvas = canvasDouble(fixture('right'));
placeNodes(canvas.data, 'root', new Set(canvas.data.nodes.map(n => n.id)));
canvas.setData(canvas.data);
canvas.select(canvas.nodes.get('b3'));
const originalViewport = { ...canvas.viewport };
feature.focusBranch(canvas, 'b3');
assert.ok(feature.displayState(canvas, canvas.data).hidden.has('b1'), 'focus hides other branches');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('root'), 'focus keeps ancestor path');
feature.fold(canvas, 'b3', true);
assert.equal(meta(canvas.nodes.get('b3').getData()).expanded, false, 'focus expansion must not persist');
assert.ok(!feature.displayState(canvas, canvas.data).hidden.has('b3c0'), 'focus expansion is visible');
feature.exitFocus(canvas);
assert.deepEqual(canvas.viewport, originalViewport, 'exit restores exact viewport');
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
