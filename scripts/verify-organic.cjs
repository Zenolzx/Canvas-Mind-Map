const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function moduleFrom(entry) {
    const result = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
    const sandbox = { module: { exports: {} }, exports: {}, require };
    vm.runInNewContext(result.outputFiles[0].text, sandbox); return sandbox.module.exports;
}
const { buildMindMapModel } = moduleFrom('src/core/MindMapModel.ts');
const { parseHeadings } = moduleFrom('src/core/HeadingParser.ts');
const { OrganicLayoutEngine } = moduleFrom('src/organic/OrganicLayoutEngine.ts');
const { NativeCanvasRenderer } = moduleFrom('src/native/NativeCanvasRenderer.ts');
const source = '---\ntitle: ignored\n---\n# Root\n## Repeat\n### Deep\n## Repeat\n```md\n# Ignored\n```\nSetext\n------\n#### Jump\n    # Code';
const headings = parseHeadings(source);
assert.equal(headings.length, 6);
assert.equal(headings[1].line, 4); assert.equal(headings[3].line, 6);
assert.equal(headings[4].line, 10); assert.equal(headings[5].level, 4);
assert.notEqual(headings[1].key, headings[3].key);
const promoted = buildMindMapModel(source, { title: 'Note', file: 'note.md' });
assert.equal(promoted.nodes[0].title, 'Root'); assert.equal(promoted.nodes[0].depth, 0);
assert.equal(promoted.nodes.find(n => n.title === 'Jump').depth, 2);
const nativeModel = buildMindMapModel(source, { title: 'Note', promoteSingleRoot: false });
let serial = 0;
const cards = new NativeCanvasRenderer().render(nativeModel, { rootId: 'canvas-root', x: 10, y: 20,
    mode: 'title', id: () => `id-${serial++}`, style: () => ({ width: 250, height: 60, color: '1', autoHeight: true }),
    payload: title => ({ data: { type: 'text', text: title }, generatedText: title }) });
assert.equal(cards.length, headings.length);
cards.forEach((card, i) => {
    assert.equal(card.canvasMindMap.key, headings[i].key);
    assert.equal(card.canvasMindMap.depth, headings[i].depth);
    assert.equal(card.canvasMindMap.parentId, headings[i].parent < 0 ? 'canvas-root' : cards[headings[i].parent].id);
});
const empty = buildMindMapModel('No headings', { title: 'Note' });
assert.equal(empty.nodes.length, 1);
assert.equal(buildMindMapModel('# A\n# B', { title: 'Note' }).nodes[0].title, 'Note');

const measureText = (text, size) => Array.from(text).reduce((sum, c) => sum + size * (/[^\x00-\xff]/.test(c) ? 1 : 0.55), 0);
const engine = new OrganicLayoutEngine();
function validate(model, collapsed = new Set()) {
    const result = engine.layout(model, { collapsed, measureText });
    assert.equal(JSON.stringify(result), JSON.stringify(engine.layout(model, { collapsed, measureText })));
    for (const n of result.nodes) {
        for (const value of [n.x, n.y, n.width, n.height, n.direction]) assert.ok(Number.isFinite(value));
        assert.ok(n.width > 0 && n.height > 0);
    }
    for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i], b = result.nodes[j];
        assert.ok(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), `overlap ${a.id} ${b.id}`);
    }
    assert.equal(result.branches.length, result.nodes.length - 1);
    for (const branch of result.branches) {
        const parent = result.nodes.find(n => n.id === branch.parentId), child = result.nodes.find(n => n.id === branch.childId);
        const sign = Math.cos(child.direction) > 0 ? 1 : -1;
        assert.ok(sign * (branch.end.x - branch.start.x) > 0, 'forward branch');
        assert.equal(branch.color, child.color);
        if (parent.depth) { assert.equal(child.rootBranchId, parent.rootBranchId); assert.equal(child.color, parent.color); }
        for (let step = 1; step < 40; step++) {
            const t = step / 40, u = 1 - t;
            const x = u**3 * branch.start.x + 3*u*u*t * branch.control1.x + 3*u*t*t * branch.control2.x + t**3 * branch.end.x;
            const y = u**3 * branch.start.y + 3*u*u*t * branch.control1.y + 3*u*t*t * branch.control2.y + t**3 * branch.end.y;
            for (const node of result.nodes) {
                if (node.id === parent.id || node.id === child.id) continue;
                assert.ok(!(x > node.x && x < node.x + node.width && y > node.y && y < node.y + node.height), `branch crosses text: ${child.id} / ${node.id}`);
            }
        }
    }
    return result;
}
const sample = `# A thoughtful life
## Learn with intention
### Ask better questions
#### Follow your curiosity
#### Challenge assumptions
### Make room for practice
### Reflect and connect
## Build small habits
### Start with two minutes
### Shape your environment
#### Make good choices visible
#### Reduce everyday friction
### Repeat with patience
## Care for your energy
### Sleep and recover
### Move every day
## Create meaningful work
### Focus on one thing
### Share what you learn
### Finish something small
## Stay connected
### Listen with attention
### Make time for people
## 探索新的可能
### 保持好奇心
### 让每一次行动都有意义`;
const model = buildMindMapModel(sample, { title: 'Sample' });
const full = validate(model);
const collapsed = new Set(model.nodes.filter(n => n.depth >= 2).map(n => n.id));
const partial = validate(model, collapsed);
assert.ok(partial.nodes.every(n => n.depth <= 2));
for (const n of partial.nodes) {
    const original = full.nodes.find(o => o.id === n.id);
    assert.equal(n.rootBranchId, original.rootBranchId); assert.equal(n.color, original.color);
    assert.equal(n.direction, original.direction);
}
validate(empty); validate(promoted);
let dense = '# Dense\n';
for (let i = 0; i < 12; i++) {
    dense += `## Branch ${i}\n`;
    for (let j = 0; j < (i % 5) + 2; j++) dense += `### 很长的中文标题需要完整换行以保持阅读清晰度和结构完整 ${i}-${j}\n#### Detail\n##### Detail\n###### Deepest\n`;
}
validate(buildMindMapModel(dense, { title: 'Dense' }));
console.log('PASS: shared parser/source lines, root promotion, native mapping, deterministic organic layout, no text overlaps, branch identity and folding.');

if (process.argv.includes('--preview')) {
    const destination = path.resolve('tmp/organic-preview'); fs.mkdirSync(destination, { recursive: true });
    const bundle = esbuild.buildSync({ entryPoints: ['src/organic/OrganicMindMapRenderer.ts'], bundle: true, format: 'iife', globalName: 'Organic', write: false });
    fs.writeFileSync(path.join(destination, 'renderer.js'), bundle.outputFiles[0].text);
    fs.writeFileSync(path.join(destination, 'layout.json'), JSON.stringify(full));
    const styles = fs.readFileSync('styles.css', 'utf8');
    const result = JSON.stringify(full).replace(/</g, '\\u003c');
    fs.writeFileSync(path.join(destination, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Organic Mind Map preview</title><style>${styles}
    body{margin:0;background:#fffaf4;color:#45423f;font-family:Arial,sans-serif} header{padding:24px 36px;font-size:13px;color:#8b8378} svg{width:100vw;height:calc(100vh - 70px)}</style>
    <header>CANVAS MIND MAP &nbsp; / &nbsp; ORGANIC · layout preview</header><svg id="map"><g id="scene"></g></svg>
    <script src="renderer.js"></script><script>const result=${result}; const svg=document.getElementById('map');const b=result.bounds;svg.setAttribute('viewBox',[b.x,b.y,b.width,b.height].join(' '));new Organic.OrganicMindMapRenderer().render(document.getElementById('scene'),result,{navigate:()=>{},toggle:()=>{},toggleLabel:c=>c?'Expand':'Collapse'});</script>`);
    console.log(destination);
}
