const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const vm = require('node:vm');

const built = esbuild.buildSync({ entryPoints: ['src/formats/DocxEditor.ts'], bundle: true, platform: 'node',
    format: 'cjs', external: ['obsidian'], write: false });
const sandbox = { module: { exports: {} }, exports: {}, require: name => name === 'obsidian' ? {} : require(name),
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, console };
vm.runInNewContext(built.outputFiles[0].text, sandbox);
const { DocxEditor } = sandbox.module.exports;
const pdfBuilt = esbuild.buildSync({ entryPoints: ['src/formats/SourceFormats.ts'], bundle: true, platform: 'node',
    format: 'cjs', external: ['obsidian'], write: false });
let outline = [{ title: 'Part One', dest: [{ num: 0 }], items: [{ title: 'Section', dest: [{ num: 1 }], items: [] }] }];
let pageText = ['First page', 'Second page'];
const pdf = { numPages: 2, getPage: async index => ({ getTextContent: async () => ({ items: [{ str: pageText[index - 1] }] }) }),
    getOutline: async () => outline, getPageIndex: async reference => reference.num, destroy: async () => {} };
const pdfSandbox = { module: { exports: {} }, exports: {}, require: name => name === 'obsidian' ? {
    loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => {} }) }),
} : require(name), Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, console };
vm.runInNewContext(pdfBuilt.outputFiles[0].text, pdfSandbox);
const { readSourceDocument } = pdfSandbox.module.exports;
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text, level) => `<w:p>${level ? `<w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const originalXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${word}"><w:body>` +
    p('Preface') + p('Chapter A', 1) + p('Alpha') + p('A child', 2) + p('Child body') +
    p('Chapter B', 1) + `<w:tbl><w:tr><w:tc>${p('Table content')}</w:tc></w:tr></w:tbl>` +
    `<w:sectPr/></w:body></w:document>`;
const entries = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(originalXml),
    'word/media/image1.png': new Uint8Array([1, 2, 3, 4]),
};
const toBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
let disk = toBuffer(zipSync(entries));
const file = { path: 'book.docx', basename: 'book' };
const app = { vault: { readBinary: async () => disk, modifyBinary: async (_file, value) => { disk = value; } } };
const titles = editor => editor.model.nodes.map(node => node.title);
(async () => {
    const editor = new DocxEditor(app, file, disk);
    assert.equal(JSON.stringify(titles(editor)), JSON.stringify(['book', 'Chapter A', 'A child', 'Chapter B']));
    assert.equal(editor.body('docx:1').text, 'Alpha');
    assert.equal(editor.body('docx:5').editable, false);
    await editor.execute({ type: 'rename', id: 'docx:1', title: 'Renamed A' });
    assert.equal(titles(editor)[1], 'Renamed A');
    await editor.execute({ type: 'body', id: 'docx:1', text: 'First\nSecond' });
    assert.equal(editor.body('docx:1').text, 'First\nSecond');
    await editor.execute({ type: 'insert', id: 'docx:1', title: 'New child', place: 'child' });
    assert.ok(titles(editor).includes('New child'));
    const child = editor.model.nodes.find(node => node.title === 'New child');
    assert.equal(editor.model.nodes.find(node => node.id === child.parentId).title, 'Renamed A');
    const originalChild = editor.model.nodes.find(node => node.title === 'A child');
    const chapterB = editor.model.nodes.find(node => node.title === 'Chapter B');
    await editor.execute({ type: 'move', id: originalChild.id, target: chapterB.id, place: 'child' });
    assert.equal(editor.model.nodes.find(node => node.title === 'A child').parentId,
        editor.model.nodes.find(node => node.title === 'Chapter B').id);
    const moved = editor.model.nodes.find(node => node.title === 'A child');
    await editor.execute({ type: 'level', id: moved.id, delta: 1 });
    assert.equal(editor.model.nodes.find(node => node.title === 'A child').headingLevel, 3);
    const beforeUndo = editor.raw;
    const latest = editor.model.nodes.find(node => node.title === 'New child');
    await editor.execute({ type: 'delete', id: latest.id });
    assert.ok(!titles(editor).includes('New child'));
    await editor.restore(beforeUndo);
    assert.ok(titles(editor).includes('New child'));
    await editor.execute({ type: 'insert', id: 'document', title: 'Appendix', place: 'child' });
    assert.equal(titles(editor).at(-1), 'Appendix');
    const complex = editor.model.nodes.find(node => node.title === 'Chapter B');
    await assert.rejects(() => editor.execute({ type: 'body', id: complex.id, text: 'Destroy table' }), /只读/);
    const image = unzipSync(new Uint8Array(disk))['word/media/image1.png'];
    assert.deepEqual(Array.from(image), [1, 2, 3, 4]);
    assert.match(strFromU8(unzipSync(new Uint8Array(disk))['word/document.xml']), /<w:tbl>/);
    const beforeConflict = disk;
    disk = toBuffer(zipSync({ ...unzipSync(new Uint8Array(disk)), 'word/custom.xml': strToU8('<changed/>') }));
    await assert.rejects(() => editor.execute({ type: 'rename', id: moved.id, title: 'Should fail' }), /外部修改/);
    assert.strictEqual(disk !== beforeConflict, true);
    const plainDocxXml = `<?xml version="1.0"?><w:document xmlns:w="${word}"><w:body>${p('Only prose')}<w:sectPr/></w:body></w:document>`;
    const plainDocx = new DocxEditor(app, file, toBuffer(zipSync({ ...entries, 'word/document.xml': strToU8(plainDocxXml) })));
    assert.equal(plainDocx.model.nodes.length, 1);
    assert.equal(plainDocx.model.nodes[0].content, 'Only prose');
    disk = toBuffer(zipSync(entries));
    const concurrentA = new DocxEditor(app, file, disk), concurrentB = new DocxEditor(app, file, disk);
    const concurrent = await Promise.allSettled([
        concurrentA.execute({ type: 'rename', id: 'docx:1', title: 'Writer A' }),
        concurrentB.execute({ type: 'rename', id: 'docx:1', title: 'Writer B' }),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
    console.log('PASS: DOCX heading/body edits, insert, move, level, media/table retention and external conflict.');
    const pdfApp = { vault: { readBinary: async () => new Uint8Array([37, 80, 68, 70]).buffer } };
    const pdfFile = { path: 'source.pdf', basename: 'source', extension: 'pdf' };
    let document = await readSourceDocument(pdfApp, pdfFile);
    assert.equal(JSON.stringify(document.model.nodes.map(node => node.title)), JSON.stringify(['source', 'Part One', 'Section']));
    assert.equal(document.model.nodes[2].source.line, 2);
    outline = [];
    document = await readSourceDocument(pdfApp, pdfFile);
    assert.equal(document.model.nodes.length, 1);
    pageText = ['', ''];
    await assert.rejects(() => readSourceDocument(pdfApp, pdfFile), /没有可提取的文字/);
    console.log('PASS: PDF bookmarks, page targets, no outline and image-only rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
