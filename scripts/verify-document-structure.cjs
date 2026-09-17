const fs = require('node:fs');
const { assert, engine, parse, section, titles, body, error } = require('./document-test-utils.cjs');
let count = 0;
function test(name, run) { try { run(); count++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } }

test('direct body and full subtree are different exact ranges', () => {
    const text = '## Architecture\n\nArchitecture intro.\n\n### Model\n\nModel text.\n\n### Tools\n\nTools text.\n\n## End\n';
    const doc = parse(text), s = section(doc, 'Architecture');
    assert.equal(body(doc, 'Architecture'), '\nArchitecture intro.\n\n');
    assert.equal(text.slice(s.subtree.start, s.subtree.end), text.slice(0, text.indexOf('## End')));
    assert.equal(s.children.length, 2);
    new engine.StructureValidator().document(doc);
});
test('rich Markdown fixture only yields document headings', () => {
    const text = fs.readFileSync('scripts/fixtures/document-structure/rich.md', 'utf8'), doc = parse(text);
    assert.deepEqual(titles(doc), ['Article', 'Architecture', 'Model', 'Tools', 'Execution', 'Evaluation']);
    assert.equal(doc.text, text); assert.deepEqual(doc.diagnostics, []);
    new engine.StructureValidator().document(doc);
});
for (const eol of ['\n', '\r\n', '\r']) test(`UTF-16 ranges preserve ${JSON.stringify(eol)} and BOM`, () => {
    const text = '\uFEFF' + ['---', 'title: 中文', '---', '', '前言 🚀', '', '# 中文 😀', '', '正文  ', '', '## 子项', 'body'].join(eol);
    const doc = parse(text), s = section(doc, '中文 😀');
    assert.equal(doc.defaultEol, eol);
    assert.equal(text.slice(doc.bom.start, doc.bom.end), '\uFEFF');
    assert.equal(text.slice(s.title.start, s.title.end), '中文 😀');
    assert.equal(text.slice(doc.introduction.start, doc.introduction.end), `${eol}前言 🚀${eol}${eol}`);
    assert.equal(body(doc, '中文 😀'), `${eol}正文  ${eol}${eol}`);
    new engine.StructureValidator().document(doc);
});
test('mixed EOL remains unchanged', () => {
    const text = '# A\r\nbody\n## B\rtext';
    const doc = parse(text); assert.equal(body(doc, 'A'), 'body\n'); assert.equal(body(doc, 'B'), 'text');
});
test('virtual root exists with one H1, multiple H1, zero headings, empty file', () => {
    for (const text of ['# A', '# A\n# B', 'Plain body', '']) {
        const doc = parse(text), projected = engine.projectDocumentMindMap(doc, 'Article.md');
        assert.equal(projected.rootId, 'document'); assert.equal(projected.nodes[0].title, 'Article.md');
        assert.equal(projected.nodes.length, doc.sections.size + 1);
        new engine.StructureValidator().document(doc);
    }
});
test('empty ATX headings and closing markers', () => {
    assert.deepEqual(titles(parse('#\n##   \n### ###\n#### Foo ####  \n')), ['', '', '', 'Foo']);
});
test('skipped levels retain real levels and semantic tree depth', () => {
    const doc = parse('## A\n#### B\n###### C\n### D\n');
    assert.deepEqual(doc.order.map(id => doc.sections.get(id).headingLevel), [2, 4, 6, 3]);
    assert.deepEqual(doc.order.map(id => doc.sections.get(id).depth), [1, 2, 3, 2]);
    assert.equal(section(doc, 'C').parentId, section(doc, 'B').id);
});
test('duplicate headings have distinct identities', () => {
    const doc = parse('# 相同\n## 相同\n## 相同\n');
    assert.equal(new Set(doc.order).size, 3);
});
test('Setext ranges include underline but body does not', () => {
    const doc = parse('Foo\r\n===\r\n\r\ntext\r\n\r\nBar\r\n---\r\nbody');
    assert.deepEqual(titles(doc), ['Foo', 'Bar']); assert.equal(section(doc, 'Bar').headingStyle, 'setext');
    assert.equal(body(doc, 'Foo'), '\r\ntext\r\n\r\n');
});
for (const [name, text] of [
    ['code fence', '```md\n# Hidden\n```\n'],
    ['tilde fence', '~~~~\n# Hidden\n~~~\n~~~~\n'],
    ['indented code', '    # Hidden\n'],
    ['quote', '> # Hidden\n'],
    ['callout', '> [!note]\n> ## Hidden\n'],
    ['callout code', '> [!note]\n> ```md\n> ## Hidden\n> ```\n'],
    ['nested quote code', '> > ```md\n> > ## Hidden\n> > ```\n'],
    ['nested list', '- item\n  ## Hidden\n'],
    ['ordered list', '1. item\n   ## Hidden\n'],
    ['HTML block', '<div>\n# Hidden\n</div>\n\n'],
    ['HTML comment', '<!--\n# Hidden\n-->\n'],
    ['math', '$$\n# Hidden\n$$\n'],
    ['Obsidian comment', '%%\n# Hidden\n%%\n'],
]) test(`${name} shields heading text`, () => {
    const doc = parse(text + '\n# Real\n'); assert.deepEqual(titles(doc), ['Real']); assert.deepEqual(doc.diagnostics, []);
});
test('frontmatter stays outside introduction', () => {
    const doc = parse('---\nvalue: "# Hidden"\n---\nIntro');
    assert.deepEqual(titles(doc), []); assert.equal(doc.text.slice(doc.introduction.start), 'Intro');
});
for (const [name, text, code] of [
    ['unclosed YAML', '---\na: b\n# A', 'unclosed-frontmatter'],
    ['unclosed fence', '# A\n```\ntext', 'unclosed-fence'],
    ['unclosed math', '# A\n$$\ntext', 'unclosed-opaque-block'],
    ['unclosed comment', '# A\n%%\ntext', 'unclosed-opaque-block'],
    ['inline comment', '# A\nText %% comment %%', 'inline-comment'],
    ['inline display math', '# A\nText $$\n# hidden\n$$', 'inline-display-math'],
    ['inline HTML comment', '# A\nText <!--\n# hidden\n-->', 'inline-html-comment'],
    ['multiline Setext', 'First\nsecond\n===\n', 'multiline-setext'],
]) test(`${name} is explicitly read-only`, () => {
    const doc = parse(text); assert.ok(doc.diagnostics.some(d => d.code === code));
    error(() => new engine.DocumentStructureTransactionService().prepare(doc, { type: 'insertChild', nodeId: 'document', title: 'New' }), 'unsupported-source');
});
test('writer rejects overlap, stale ranges, duplicate anchors and invalid offsets', () => {
    const writer = new engine.MarkdownStructureWriter();
    error(() => writer.apply('abc', [{ range: { start: 0, end: 2 }, expectedText: 'ab', replacement: '' },
        { range: { start: 1, end: 3 }, expectedText: 'bc', replacement: '' }]), 'invalid-range');
    error(() => writer.apply('abc', [{ range: { start: 0, end: 1 }, expectedText: 'z', replacement: '' }]), 'stale-range');
    error(() => writer.apply('abc', [{ range: { start: -1, end: 0 }, expectedText: '', replacement: '' }]), 'invalid-range');
    error(() => writer.apply('abc', [], [{ id: 'x', offset: 0 }, { id: 'x', offset: 1 }]), 'duplicate-identity');
});
console.log(`Document structure: ${count} checks passed.`);
