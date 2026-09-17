const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');
function load(path) {
    const out = esbuild.buildSync({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false });
    const m = { exports: {} }; new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports); return m.exports;
}
const { buildMindMapModel } = load('src/core/MindMapModel.ts');
const { OrganicLayoutEngine } = load('src/organic/OrganicLayoutEngine.ts');
const { reconcileOrganicModel } = load('src/organic/OrganicNodeIdentity.ts');
const { OrganicSearchController } = load('src/organic/OrganicSearchController.ts');
const { OrganicViewportController } = load('src/organic/OrganicViewportController.ts');
const engine = new OrganicLayoutEngine();
for (const size of [50, 200, 500]) {
    const markdown = Array.from({ length: size }, (_, i) => `${'#'.repeat(i === 0 ? 1 : i % 25 === 1 ? 2 : i % 5 === 2 ? 3 : 4)} 标题 ${i} ${i % 7 === 0 ? '很长的中文标题 😀 streamAssistantResponse '.repeat(4) : 'Section'}`).join('\n');
    const model = buildMindMapModel(markdown, { title: 'scale' });
    const old = reconcileOrganicModel(model);
    const refreshStart = performance.now();
    const refreshed = reconcileOrganicModel(buildMindMapModel(markdown + '\n## Added section', { title: 'scale' }), old.identities);
    const refreshMs = performance.now() - refreshStart;
    const search = new OrganicSearchController(), searchStart = performance.now();
    search.update(refreshed.model, 'streamAssistantResponse');
    assert.ok(search.results.length > 0);
    const searchMs = performance.now() - searchStart;
    const viewport = new OrganicViewportController(), panStart = performance.now();
    for (let i = 0; i < 1000; i++) { viewport.zoom(i % 2 ? 1 / 1.01 : 1.01, 500, 350); viewport.offset.x += 1; }
    console.log(`PERF: ${size} headings; parse/reconcile ${refreshMs.toFixed(1)} ms; search ${searchMs.toFixed(2)} ms; 1000 viewport updates ${(performance.now()-panStart).toFixed(2)} ms`);
    for (const style of ['organic-radial', 'organic-horizontal', 'compact-organic']) {
        const start = performance.now();
        const result = engine.layout(model, { style, collapsed: new Set(), measureText: (s, size) => Array.from(s).length * size * 0.65 });
        const ms = performance.now() - start;
        assert.equal(result.nodes.length, size);
        for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
            const a = result.nodes[i], b = result.nodes[j];
            assert.ok(!(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height), `${style}: ${a.title}/${b.title} overlap`);
        }
        for (const b of result.branches) for (const p of [b.start, b.control1, b.control2, b.end]) {
            assert.ok(p.x >= result.bounds.x && p.x <= result.bounds.x + result.bounds.width);
            assert.ok(p.y >= result.bounds.y && p.y <= result.bounds.y + result.bounds.height);
        }
        console.log(`PASS: ${style}, ${size} headings, no overlap, bounds contain curves; layout ${ms.toFixed(1)} ms`);
    }
}
