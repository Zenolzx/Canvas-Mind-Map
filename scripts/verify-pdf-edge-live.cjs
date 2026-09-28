const path = require('node:path');
const { chromium } = require(process.env.CMM_PLAYWRIGHT || 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
    try {
        const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('index.html'));
        if (!page || await page.evaluate(() => app.vault.adapter.getBasePath()) !== path.resolve('tmp/obsidian-writing-live'))
            throw new Error('Unexpected vault');
        await page.evaluate(async () => { await app.plugins.disablePlugin('canvas-mind-map'); await app.plugins.enablePlugin('canvas-mind-map'); });
        await page.waitForFunction(() => !!app.vault.getAbstractFileByPath('No-outline.pdf') && !!app.vault.getAbstractFileByPath('Scanned.pdf'));
        const result = await page.evaluate(async () => {
            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: 'canvas-mind-map-organic', state: { file: 'No-outline.pdf' }, active: true });
            const plain = leaf.view.model.nodes.map(node => node.title);
            if (plain.join('|') !== 'No-outline') throw new Error(`Unexpected no-outline PDF nodes: ${plain}`);
            await leaf.setViewState({ type: 'canvas-mind-map-organic', state: { file: 'Scanned.pdf' }, active: true });
            const scanned = leaf.view.model?.nodes.map(node => node.title) ?? [];
            const message = leaf.view.status.textContent;
            if (scanned.length || !message.includes('没有可提取的文字')) throw new Error(`Image-only PDF state: ${scanned} / ${message}`);
            return { plain, scanned, message };
        });
        console.log('PASS real Obsidian PDF edge cases:', JSON.stringify(result));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
