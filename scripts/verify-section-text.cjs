const { assert, engine } = require('./document-test-utils.cjs');
const { SectionTextBuffer, normalizeEditorText } = engine;
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }
test('mixed line endings and UTF-16 offsets', () => {
    const buffer = new SectionTextBuffer('\uFEFF中文\r\n😀\rnext\n');
    assert.equal(buffer.editorText, '\uFEFF中文\n😀\nnext\n');
    for (let i = 0; i <= buffer.editorText.length; i++) {
        assert.equal(normalizeEditorText(buffer.sourceText.slice(0, buffer.sourceOffset(i))), buffer.editorText.slice(0, i));
    }
});
test('editing one word preserves all untouched bytes', () => {
    const raw = 'first\r\nword\rlast\n';
    const buffer = new SectionTextBuffer(raw);
    const next = buffer.apply(buffer.editorText, [{ from: 6, to: 10, insert: '中文😀' }]);
    assert.equal(next.sourceText, 'first\r\n中文😀\rlast\n');
    assert.equal(buffer.sourceText, raw);
});
test('multiple edits use original coordinates', () => {
    const buffer = new SectionTextBuffer('a\r\nb\rc\n', '\r\n');
    const next = buffer.apply(buffer.editorText, [
        { from: 0, to: 1, insert: 'A\nA' }, { from: 4, to: 5, insert: 'C' }
    ]);
    assert.equal(next.sourceText, 'A\r\nA\r\nb\rC\n');
});
test('newline deletion removes the complete CRLF', () => {
    const buffer = new SectionTextBuffer('a\r\nb');
    assert.equal(buffer.apply(buffer.editorText, [{ from: 1, to: 2, insert: '' }]).sourceText, 'ab');
});
test('paste uses insertion policy, unchanged newlines survive', () => {
    const buffer = new SectionTextBuffer('a\r\n', '\r');
    assert.equal(buffer.apply(buffer.editorText, [{ from: 2, to: 2, insert: 'b\r\nc\rd\n' }]).sourceText, 'a\r\nb\rc\rd\r');
});
test('empty edits preserve exact source', () => {
    const buffer = new SectionTextBuffer('a\r\nb\r');
    assert.equal(buffer.apply(buffer.editorText, []).sourceText, buffer.sourceText);
});
test('stale snapshot rejected without mutation', () => {
    const buffer = new SectionTextBuffer('abc');
    assert.throws(() => buffer.apply('abd', [{ from: 0, to: 1, insert: 'X' }]));
    assert.equal(buffer.sourceText, 'abc');
});
test('invalid and ambiguous ranges rejected', () => {
    const buffer = new SectionTextBuffer('abc');
    for (const changes of [
        [{ from: -1, to: 0, insert: '' }], [{ from: 0, to: 4, insert: '' }],
        [{ from: 1.5, to: 2, insert: '' }], [{ from: 2, to: 1, insert: '' }],
        [{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }],
        [{ from: 0, to: 0, insert: 'x' }, { from: 0, to: 0, insert: 'y' }]
    ]) assert.throws(() => buffer.apply(buffer.editorText, changes));
});
test('successive edits match editor text through 500 changes', () => {
    let buffer = new SectionTextBuffer('中文\r\n😀\rbody\n', '\r\n');
    let expected = buffer.editorText;
    for (let i = 0; i < 500; i++) {
        const from = (i * 7) % (expected.length + 1);
        const to = Math.min(expected.length, from + i % 3);
        const insert = ['x', '\n', '中文', ''][i % 4];
        buffer = buffer.apply(expected, [{ from, to, insert }]);
        expected = expected.slice(0, from) + insert + expected.slice(to);
        assert.equal(buffer.editorText, expected);
    }
});
console.log(`${checks} section text checks passed`);
