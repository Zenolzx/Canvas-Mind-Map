const path = require('node:path');
const { chromium } = require(process.env.CMM_PLAYWRIGHT || 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
    try {
        const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('index.html'));
        if (!page) throw new Error('Isolated Obsidian vault is not open');
        await page.waitForFunction(() => window.app?.workspace?.layoutReady);
        const expected = path.resolve('tmp/obsidian-writing-live');
        const actual = await page.evaluate(() => app.vault.adapter.getBasePath());
        if (actual !== expected) throw new Error(`Refusing to operate outside isolated test vault: ${actual}`);
        await page.evaluate(async () => {
            await app.plugins.disablePlugin('canvas-mind-map');
            await app.plugins.enablePlugin('canvas-mind-map');
        });
        await page.waitForFunction(() => !!app.vault.getAbstractFileByPath('Format-source.docx') &&
            !!app.vault.getAbstractFileByPath('Format-source.pdf'));
        const result = await page.evaluate(async () => {
            const word = app.vault.getAbstractFileByPath('Format-source.docx');
            const pdf = app.vault.getAbstractFileByPath('Format-source.pdf');
            const leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: 'canvas-mind-map-organic', state: { file: word.path }, active: true });
            const view = leaf.view;
            const original = view.model.nodes.map(node => node.title);
            if (original.join('|') !== 'Format-source|Chapter A|A child|Chapter B') throw new Error(`DOCX model: ${original}`);
            await view.toggleWriting();
            if (!view.docxWriting?.active) throw new Error('DOCX Organic Edit did not open');
            const chapter = view.model.nodes.find(node => node.title === 'Chapter A');
            if (!await view.docxWriting.execute({ type: 'rename', id: chapter.id, title: 'Revised Chapter' }))
                throw new Error('DOCX rename failed');
            const revised = view.model.nodes.find(node => node.title === 'Revised Chapter');
            await view.docxWriting.select(revised.id);
            view.docxWriting.textarea.value = 'Edited plain body';
            if (!await view.docxWriting.flush()) throw new Error('DOCX body write failed');
            const rich = view.model.nodes.find(node => node.title === 'Chapter B');
            await view.docxWriting.select(rich.id);
            if (!view.docxWriting.textarea.readOnly) throw new Error('Rich DOCX body unexpectedly editable');
            await view.toggleWriting();
            const persisted = (await app.vault.readBinary(word)).byteLength;
            const pdfLeaf = app.workspace.getLeaf('tab');
            await pdfLeaf.setViewState({ type: 'canvas-mind-map-organic', state: { file: pdf.path }, active: true });
            const pdfView = pdfLeaf.view;
            const pdfTitles = pdfView.model.nodes.map(node => node.title);
            if (pdfTitles.join('|') !== 'Format-source|Part One|Section') throw new Error(`PDF outline: ${pdfTitles}`);
            await pdfView.toggleWriting();
            if (pdfView.isWriting) throw new Error('PDF became editable');
            return { original, revised: view.model.nodes.map(node => node.title), persisted, pdfTitles };
        });
        console.log('PASS real Obsidian DOCX/PDF Organic:', JSON.stringify(result));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
