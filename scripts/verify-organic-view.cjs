// Controller tests use an Obsidian boundary stub, not a running vault or browser.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const notices = [];
class ItemView { constructor(leaf) { this.app = leaf.app; this.contentEl = { empty() {} }; } }
const obsidian = { ItemView, Notice: class { constructor(message) { notices.push(message); } } };
const output = esbuild.buildSync({ entryPoints: ['src/organic/OrganicMindMapView.ts'], bundle: true,
    platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
const sandbox = { module: { exports: {} }, exports: {}, console, require: name => name === 'obsidian' ? obsidian : require(name) };
vm.runInNewContext(output.outputFiles[0].text, sandbox);
const { OrganicMindMapView } = sandbox.module.exports;

(async () => {
    let source = '# Root\n## A\n### Nested\n#### Deep\n## B\n### Repeat\n### Repeat';
    const file = { path: 'note.md', basename: 'note' };
    let opened = [], leaves = [], actions;
    const app = { vault: { read: async () => source }, workspace: {
        getLeaf: () => { const leaf = { openFile: async (file, state) => opened.push({ file, state }) }; leaves.push(leaf); return leaf; },
        getLeavesOfType: () => leaves,
    } };
    const view = new OrganicMindMapView({ app });
    view.svg = { clientWidth: 1000, clientHeight: 700 };
    view.scene = { setAttribute() {}, querySelectorAll: () => [] };
    view.status = {}; view.measure = (text, size) => text.length * size * 0.6;
    view.renderer = { render: (scene, result, callbacks) => { actions = callbacks; } };
    await view.loadSource(file);
    assert.ok(view.result.nodes.every(n => n.depth <= 2));
    const nested = view.result.nodes.find(n => n.title === 'Nested');
    const screen = id => { const n = view.result.nodes.find(n => n.id === id); return [n.x * view.scale + view.offset.x, n.y * view.scale + view.offset.y]; };
    const before = screen(nested.id);
    actions.toggle(nested.id);
    assert.ok(view.result.nodes.some(n => n.title === 'Deep'));
    screen(nested.id).forEach((v, i) => assert.ok(Math.abs(v - before[i]) < 1e-8, 'fold anchor moved on screen'));
    const rootId = view.model.rootId;
    actions.toggle(rootId); assert.equal(view.result.nodes.length, 1);
    actions.toggle(rootId); assert.ok(view.result.nodes.some(n => n.title === 'Deep'), 'descendant expansion survives parent folding');
    const point = [(123 - view.offset.x) / view.scale, (234 - view.offset.y) / view.scale];
    view.zoom(1.3, 123, 234);
    assert.ok(Math.abs(point[0] * view.scale + view.offset.x - 123) < 1e-8);
    assert.ok(Math.abs(point[1] * view.scale + view.offset.y - 234) < 1e-8);
    const repeat = view.model.nodes.filter(n => n.title === 'Repeat')[1];
    await view.navigate(repeat.id);
    assert.equal(opened[0].state.eState.line, 6, 'duplicate heading must use precise line');
    await view.navigate(repeat.id); assert.equal(leaves.length, 1, 'reuse source pane');
    source = '\n' + source;
    await view.navigate(repeat.id); assert.equal(opened.length, 2, 'stale source must not navigate to wrong line');
    assert.ok(notices.length);
    await view.loadSource(file, false); await view.navigate(repeat.id);
    assert.equal(opened[2].state.eState.line, 7, 'refresh updates source mapping');
    let finish;
    app.vault.read = () => new Promise(resolve => { finish = resolve; });
    const pending = view.loadSource(file); await view.onClose(); finish('# Changed'); await pending;
    assert.equal(view.model.nodes[0].title, 'Root', 'closed view must discard async load');
    console.log('PASS: default depth, fold screen anchor, expansion memory, cursor zoom, duplicate source navigation, stale-source guard, refresh and close race.');
})().catch(error => { console.error(error); process.exitCode = 1; });
