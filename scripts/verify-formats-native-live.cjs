const path = require('node:path');
const { chromium } = require(process.env.CMM_PLAYWRIGHT || 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
    try {
        const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('index.html'));
        if (!page) throw new Error('Isolated Obsidian vault is not open');
        const expected = path.resolve('tmp/obsidian-writing-live');
        if (await page.evaluate(() => app.vault.adapter.getBasePath()) !== expected) throw new Error('Unexpected vault');
        const result = await page.evaluate(async () => {
            const source = app.vault.getAbstractFileByPath('Format-native.canvas');
            const initial = { nodes: [
                { id: 'word', type: 'file', file: 'Format-source.docx', x: 0, y: 0, width: 240, height: 140 },
                { id: 'pdf', type: 'file', file: 'Format-source.pdf', x: 600, y: 0, width: 240, height: 140 },
            ], edges: [] };
            const file = source ?? await app.vault.create('Format-native.canvas', JSON.stringify(initial));
            if (source) await app.vault.modify(file, JSON.stringify(initial));
            const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file);
            await new Promise(resolve => setTimeout(resolve, 500));
            const canvas = leaf.view.canvas, feature = app.plugins.plugins['canvas-mind-map'].mindmap;
            if (!canvas?.nodes.get('word') || !canvas.nodes.get('pdf')) throw new Error('Canvas source cards missing');
            await feature.generate(canvas, canvas.nodes.get('word'), 'title', 'right');
            await feature.generate(canvas, canvas.nodes.get('pdf'), 'title', 'right');
            const generated = canvas.getData();
            const titles = generated.nodes.filter(node => node.canvasMindMap).map(node => node.canvasMindMap.title);
            if (!titles.includes('Revised Chapter') || !titles.includes('Part One')) throw new Error(`Canvas generated titles: ${titles}`);
            const roots = generated.nodes.filter(node => node.canvasMindMap?.compact);
            if (roots.length !== 2) throw new Error(`Expected two generated maps, got ${roots.length}`);
            await feature.refresh(canvas, roots[0].id);
            return { titles, roots: roots.length, edges: canvas.getData().edges.length };
        });
        console.log('PASS real Obsidian Native Canvas DOCX/PDF:', JSON.stringify(result));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
