// Controller tests use an Obsidian boundary stub, not a running vault or browser.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const notices = [], rendered = [];
class Element {
    constructor() { this.children = []; this.style = { setProperty() {} }; this.classList = { toggle() {} }; }
    createEl(tag, options = {}) { const el = new Element(); el.tag = tag; el.text = options.text; this.children.push(el); return el; }
    createDiv(options) { return this.createEl('div', options); }
    empty() { this.children = []; }
    setCssProps(props) { Object.assign(this.style, props); }
    setAttribute() {}
}
class Component { load() {} unload() { this.unloaded = true; } }

class ItemView { constructor(leaf) { this.app = leaf.app; this.contentEl = { empty() {} }; } }
const obsidian = { Component, MarkdownRenderer: { render: async (app, text, el, path, component) => rendered.push({ text, el, path, component }) }, ItemView, Notice: class { constructor(message) { notices.push(message); } } };
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
        requestSaveLayout() {}, getLeavesOfType: () => leaves,
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
    // Reader uses direct body ranges, never descendant bodies; selection and split do not navigate.
    source = 'Intro\n# Parent\n**bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- list\n\n```js\ncode()\n```\n[link](other.md)\n## Child\nChild body\n# Empty\n## Leaf\n' + 'long body\n'.repeat(100);
    await view.loadSource(file, false);
    view.readerPane = new Element(); view.readerVisible = true;
    view.writingLayout = new Element(); view.editorPane = new Element();
    view.viewport.pan(240, -120); view.zoom(1.7, 150, 200);
    const live = () => JSON.stringify({ offset: view.offset, scale: view.scale });
    const stable = live(), sourceOpens = opened.length;
    const parent = view.model.nodes.find(n => n.title === 'Parent');
    await view.navigate(parent.id);
    assert.equal(live(), stable);
    assert.equal(opened.length, sourceOpens, 'Reader selection must not open source');
    assert.ok(rendered.at(-1).text.includes('**bold**'));
    assert.ok(rendered.at(-1).text.includes('| A | B |'));
    assert.ok(rendered.at(-1).text.includes('```js'));
    assert.ok(!rendered.at(-1).text.includes('Child body'));
    const component = rendered.at(-1).component;
    const childLink = view.readerPane.children.find(el => el.tag === 'ul').children[0].children[0];
    childLink.onclick();
    assert.equal(view.model.nodes.find(n => n.id === view.state.selectedNode).title, 'Child');
    assert.equal(rendered.at(-1).text.trim(), 'Child body');
    assert.ok(component.unloaded);
    assert.equal(live(), stable);
    await view.navigate(view.model.nodes.find(n => n.title === 'Empty').id);
    assert.equal(rendered.at(-1).text.trim(), '');
    assert.ok(view.readerPane.children.some(el => el.tag === 'ul'));
    await view.navigate(view.model.nodes.find(n => n.title === 'Leaf').id);
    assert.ok(rendered.at(-1).text.length > 500);
    assert.equal(live(), stable);
    await view.navigate(view.model.rootId);
    assert.equal(rendered.at(-1).text.trim(), 'Intro');
    for (const visible of [false, true, false, true]) { view.readerVisible = visible; view.applySplit(); assert.equal(live(), stable); }
    const cached = view.result; await view.selectHeading(parent.id);
    assert.equal(view.result, cached, 'selection should reuse cached layout');
    view.fit(); assert.notEqual(live(), stable, 'explicit fit changes viewport');
    let finish;
    app.vault.read = () => new Promise(resolve => { finish = resolve; });
    const pending = view.loadSource(file); await view.onClose(); finish('# Changed'); await pending;
    assert.equal(view.model.nodes[0].title, 'note', 'closed view must discard async load');
    console.log('PASS: default depth, fold screen anchor, expansion memory, cursor zoom, duplicate source navigation, stale-source guard, refresh, direct-body Reader/children, Markdown renderer input, stable pan/zoom/split, cached selection layout and close race.');
})().catch(error => { console.error(error); process.exitCode = 1; });
