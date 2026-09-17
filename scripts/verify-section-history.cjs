const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const { EditorState, Transaction } = require('@codemirror/state');
const { history, undo, redo, isolateHistory } = require('@codemirror/commands');
const bundle = esbuild.buildSync({ entryPoints: ['src/writing/SectionEditorState.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@codemirror/*'] });
const output = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(output, output.exports, require);
const { sectionTextExtension } = output.exports;
function session(raw) {
    const extension = sectionTextExtension(raw, '\r\n');
    const target = { state: EditorState.create({ doc: raw.replace(/\r\n?/g, '\n'), extensions: [history(), extension.extension] }),
        dispatch(tr) { target.state = tr.state; } };
    return { target, raw: () => target.state.field(extension.field).sourceText,
        edit: (from, to, insert, grouped = false) => target.dispatch(target.state.update({ changes: { from, to, insert },
            annotations: grouped ? Transaction.userEvent.of('input.type') : isolateHistory.of('full') })) };
}
for (const raw of ['a\r\nb\rc\n', '\uFEFF中文\r\n😀\rbody\n', '', 'last']) {
    const s = session(raw), snapshots = [raw];
    s.edit(0, Math.min(2, s.target.state.doc.length), 'X\n'); snapshots.push(s.raw());
    s.edit(s.target.state.doc.length, s.target.state.doc.length, '尾\n'); snapshots.push(s.raw());
    assert.ok(undo(s.target)); assert.equal(s.raw(), snapshots[1]);
    assert.ok(undo(s.target)); assert.equal(s.raw(), snapshots[0]);
    assert.ok(redo(s.target)); assert.equal(s.raw(), snapshots[1]);
    assert.ok(redo(s.target)); assert.equal(s.raw(), snapshots[2]);
}
const grouped = session('a\r\nb\rc\n');
grouped.edit(1, 2, '', true); grouped.edit(1, 2, 'Z', true);
const after = grouped.raw();
while (undo(grouped.target)) {}
assert.equal(grouped.raw(), 'a\r\nb\rc\n');
while (redo(grouped.target)) {}
assert.equal(grouped.raw(), after);
console.log('PASS CodeMirror raw text undo/redo: four source formats and grouped history');
