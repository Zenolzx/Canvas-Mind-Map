const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
function load(path) {
    const output = esbuild.buildSync({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false });
    const scope = { module: { exports: {} }, exports: {}, require };
    vm.runInNewContext(output.outputFiles[0].text, scope);
    return scope.module.exports;
}
const { meta, placeNodes, assignAngles, treeEdge, hiddenNodes, overlaps, descendants } = load('src/native/NativeCanvasModel.ts');
const { applyBranchAppearance } = load('src/native/NativeAppearance.ts');
function fixture(layout) {
    const nodes = [];
    function add(id, parentId, depth, title) {
        const width = depth === 0 ? 340 : depth === 1 ? 260 : 220, height = depth === 0 ? 100 : 65;
        nodes.push({ id, type: 'text', text: title, x: 0, y: 0, width, height, color: '', canvasMindMap: {
            version: 1, nodeId: id, rootId: 'root', parentId, depth, title, key: id, mode: 'title',
            expanded: true, placed: false, angle: 0, layout,
            style: { width, height, autoHeight: true, color: '' }, applied: { width, height, color: '' },
        }});
    }
    add('root', undefined, 0, 'Canvas Mind Map');
    ['产品目标', '阅读与探索', '布局架构', 'Native 兼容性', '交互体验', '视觉层级', '总结'].forEach((title, i) => {
        add(`b${i}`, 'root', 1, title);
        for (let j = 0; j < [1, 3, 6, 4, 3, 2, 0][i]; j++) add(`b${i}c${j}`, `b${i}`, 2, ['标题与源笔记', '子树空间分配', '清晰的阅读方向', '稳定分支颜色', '保留手动编辑', '展开与收起'][j]);
    });
    return { nodes, edges: nodes.slice(1).map(n => treeEdge(`e${n.id}`, 'root', meta(n).parentId, n.id)) };
}
function noOverlap(data) {
    const hidden = hiddenNodes(data.nodes), visible = data.nodes.filter(n => !hidden.has(n.id));
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++)
        assert.ok(!overlaps(visible[i], visible[j], 0), `overlap ${visible[i].id}/${visible[j].id}`);
}
const previews = [];
for (const layout of ['horizontal', 'vertical', 'right', 'left', 'down', 'up', 'radial']) {
    const data = fixture(layout);
    assignAngles(data.nodes, 'root');
    placeNodes(data, 'root', new Set(data.nodes.slice(1).map(n => n.id)));
    applyBranchAppearance(data, 'root');
    noOverlap(data);
    const repeated = fixture(layout);
    assignAngles(repeated.nodes, 'root');
    placeNodes(repeated, 'root', new Set(repeated.nodes.slice(1).map(n => n.id)));
    assert.deepEqual(data.nodes.map(n => [n.x, n.y]), repeated.nodes.map(n => [n.x, n.y]), `${layout}: deterministic`);
    previews.push({ layout, data: JSON.parse(JSON.stringify(data)) });
    const branch = data.nodes.find(n => n.id === 'b2');
    meta(branch).expanded = false;
    const before = data.nodes.map(n => [n.id, n.x, n.y]);
    placeNodes(data, 'root', new Set(), branch.id);
    meta(branch).expanded = true;
    const members = new Set(descendants(data.nodes, branch.id).map(n => n.id));
    // An unrelated card in the proposed child area must stay put.
    const target = data.nodes.find(n => n.id === 'b2c0');
    const obstacle = { id: 'external', type: 'text', text: 'external', x: target.x - 5, y: target.y - 5,
        width: target.width + 10, height: target.height + 10 };
    data.nodes.push(obstacle);
    const obstacleBefore = JSON.stringify(obstacle);
    placeNodes(data, 'root', members, branch.id);
    noOverlap(data);
    assert.equal(JSON.stringify(obstacle), obstacleBefore, 'external card changed');
    for (const [id, x, y] of before) if (!members.has(id)) {
        const n = data.nodes.find(n => n.id === id);
        assert.deepEqual([n.x, n.y], [x, y], `${layout}: fixed node moved`);
    }
    const colors = data.nodes.filter(n => meta(n)).map(n => [n.id, n.color]);
    const custom = data.nodes.find(n => n.id === 'b2c0');
    custom.color = '#123456'; custom.width = 477; custom.height = 144;
    const customEdge = data.edges[0]; customEdge.color = '#abcdef';
    const clearedEdge = data.edges[1]; delete clearedEdge.color;
    applyBranchAppearance(data, 'root');
    assert.deepEqual([custom.color, custom.width, custom.height], ['#123456', 477, 144]);
    assert.equal(customEdge.color, '#abcdef', 'manual edge color lost');
    assert.equal(clearedEdge.color, undefined, 'manually cleared edge color lost');
    for (const [id, color] of colors) if (id !== custom.id) assert.equal(data.nodes.find(n => n.id === id).color, color);
    for (const n of data.nodes.filter(n => meta(n)?.depth === 2 && n !== custom)) {
        assert.equal(n.color, data.nodes.find(p => p.id === meta(n).parentId).color, 'branch color mismatch');
    }
}
if (process.argv.includes('--preview')) {
    const fs = require('node:fs');
    fs.mkdirSync('tmp/native-preview', { recursive: true });
    fs.writeFileSync('tmp/native-preview/layouts.json', JSON.stringify(previews));
}
console.log('PASS: all seven Native layouts, deterministic geometry, local anchors, external obstacles, branch identity and manual style overrides.');
