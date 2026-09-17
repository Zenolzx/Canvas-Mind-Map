const { assert, engine, parse, section } = require('./document-test-utils.cjs');
let count = 0;

/** Test host, not a production IO adapter. Models an atomic critical section and live buffers. */
class MemoryHost {
    constructor(text) { this.text = text; this.editorsSynchronized = true; this.writes = 0; this.failure = null; this.hook = null; this.pending = Promise.resolve(); }
    async read() { return { text: this.text, editorsSynchronized: this.editorsSynchronized }; }
    process(path, transform) {
        const run = this.pending.catch(() => {}).then(async () => {
            if (this.hook) { const hook = this.hook; this.hook = null; await hook(this); }
            if (this.failure === 'before') throw new Error('IO failed before write');
            const result = transform({ text: this.text, editorsSynchronized: this.editorsSynchronized });
            this.text = result; this.writes++;
            if (this.failure === 'after') throw new Error('IO failed after write');
            if (this.failure === 'mismatch') return 'unexpected host result';
            return result;
        });
        this.pending = run; return run;
    }
}
const create = (text = '# A\nbody\n## B\nchild\n') => {
    const host = new MemoryHost(text), coordinator = new engine.DocumentChangeCoordinator(parse(text), host);
    return { host, coordinator };
};
const rename = (coordinator, title = 'Renamed') => coordinator.prepare({ type: 'rename', nodeId: coordinator.document.order[0], title });
const fails = (promise, code) => assert.rejects(promise, e => e.code === code, code);
async function test(name, run) { try { await run(); count++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } }

(async () => {
    await test('prepare is pure; commit advances model and history only after successful IO', async () => {
        const { host, coordinator } = create(), tx = rename(coordinator);
        assert.equal(host.writes, 0); assert.equal(host.text, tx.before.text);
        const result = await coordinator.commit(tx);
        assert.equal(host.writes, 1); assert.equal(host.text, tx.after.text); assert.equal(result.document, tx.after);
        assert.equal(coordinator.history.canUndo, true); assert.equal(coordinator.history.canRedo, false);
    });
    await test('undo and redo restore exact CRLF BOM formatting, IDs and view state', async () => {
        const { host, coordinator } = create('\uFEFF# A\r\nbody  \r\n## B\r\nchild');
        const original = host.text, ids = [...coordinator.document.order];
        const view = { selectedNode: ids[0], collapsed: [ids[1]], zoom: 1.25, center: { x: 10, y: -4 }, focusNode: null };
        const tx = rename(coordinator), afterView = { ...view, zoom: 2 };
        await coordinator.commit(tx, view, afterView);
        view.center.x = 99;
        const undo = await coordinator.undo();
        assert.equal(host.text, original); assert.deepEqual(undo.document.order, ids); assert.equal(undo.view.center.x, 10);
        assert.equal(undo.document.revision, 2);
        const redo = await coordinator.redo(); assert.equal(host.text, tx.after.text); assert.equal(redo.view.zoom, 2);
        assert.equal(redo.document.revision, 3);
    });
    await test('all structure operations can be undone exactly in reverse order', async () => {
        const original = '# A\nA body\n## B\nB body\n### C\nC body\n# D\nD body';
        const { host, coordinator } = create(original);
        const id = title => section(coordinator.document, title).id;
        const operations = [
            () => ({ type: 'rename', nodeId: id('B'), title: '中文 🚀' }),
            () => ({ type: 'insertSibling', nodeId: id('中文 🚀'), title: 'E' }),
            () => ({ type: 'insertChild', nodeId: id('E'), title: 'F' }),
            () => ({ type: 'promote', nodeId: id('中文 🚀') }),
            () => ({ type: 'demote', nodeId: id('D') }),
            () => ({ type: 'moveBefore', nodeId: id('E'), targetId: id('中文 🚀') }),
            () => ({ type: 'delete', nodeId: id('E'), strategy: 'promoteChildren' }),
            () => ({ type: 'delete', nodeId: id('C'), strategy: 'subtree' }),
            () => ({ type: 'updateBody', nodeId: id('D'), markdown: '\nNew body\n## Dataset\ndata\n' }),
        ];
        const snapshots = [original];
        for (const operation of operations) { await coordinator.commit(coordinator.prepare(operation())); snapshots.push(host.text); }
        for (let i = snapshots.length - 2; i >= 0; i--) { await coordinator.undo(); assert.equal(host.text, snapshots[i]); }
        for (let i = 1; i < snapshots.length; i++) { await coordinator.redo(); assert.equal(host.text, snapshots[i]); }
    });
    await test('external disk change cancels operation without a write, refresh invalidates old targets', async () => {
        const { host, coordinator } = create(), tx = rename(coordinator), oldId = coordinator.document.order[0];
        host.text += '\nEXTERNAL NEW CONTENT';
        const external = host.text;
        await fails(coordinator.commit(tx), 'source-conflict'); assert.equal(host.text, external); assert.equal(host.writes, 0);
        assert.equal(coordinator.needsRefresh, true); assert.equal(coordinator.history.canUndo, false);
        const refreshed = await coordinator.refresh(); assert.equal(refreshed.text, external); assert.ok(!refreshed.sections.has(oldId));
        await fails(coordinator.commit(tx), 'stale-transaction');
    });
    await test('concurrent edit between prepare and atomic callback cannot be overwritten', async () => {
        const { host, coordinator } = create(), tx = rename(coordinator);
        host.hook = host => { host.text = '# External\nNewest text'; };
        await fails(coordinator.commit(tx), 'source-conflict'); assert.equal(host.text, '# External\nNewest text'); assert.equal(host.writes, 0);
    });
    await test('unsaved editor blocks commit even when disk text has not changed', async () => {
        const { host, coordinator } = create(), tx = rename(coordinator), original = host.text;
        host.editorsSynchronized = false;
        await fails(coordinator.commit(tx), 'editor-conflict'); assert.equal(host.text, original); assert.equal(host.writes, 0);
        await fails(coordinator.refresh(), 'editor-conflict');
        host.editorsSynchronized = true; await coordinator.refresh();
        await coordinator.commit(rename(coordinator)); assert.equal(host.writes, 1);
    });
    await test('queued stale operations are rejected instead of applied against new positions', async () => {
        const { host, coordinator } = create(), first = rename(coordinator, 'First'), second = rename(coordinator, 'Second');
        const results = await Promise.allSettled([coordinator.commit(first), coordinator.commit(second)]);
        assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
        assert.equal(results[1].reason.code, 'stale-transaction'); assert.equal(host.writes, 1); assert.ok(host.text.startsWith('# First'));
    });
    await test('two coordinators share host atomicity rather than separate read/modify races', async () => {
        const { host, coordinator: a } = create(), b = new engine.DocumentChangeCoordinator(parse(host.text), host);
        const results = await Promise.allSettled([a.commit(rename(a, 'First')), b.commit(rename(b, 'Second'))]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(host.writes, 1);
        assert.equal(results.find(r => r.status === 'rejected').reason.code, 'source-conflict');
    });
    await test('external change after own commit is not mistaken for self event', async () => {
        const { host, coordinator } = create();
        await coordinator.commit(rename(coordinator)); host.text += '\nExternal';
        assert.equal(await coordinator.observeSource(), 'external'); assert.equal(coordinator.needsRefresh, true);
        assert.equal(host.writes, 1);
    });
    await test('self notifications and repeated notifications do not write or loop', async () => {
        const { host, coordinator } = create(); await coordinator.commit(rename(coordinator));
        assert.equal(await coordinator.observeSource(), 'self'); assert.equal(await coordinator.observeSource(), 'unchanged');
        assert.equal(await coordinator.observeSource(), 'unchanged'); assert.equal(host.writes, 1);
    });
    await test('undo cannot overwrite external modifications', async () => {
        const { host, coordinator } = create(); await coordinator.commit(rename(coordinator));
        host.text += '\nExternal'; const external = host.text;
        await fails(coordinator.undo(), 'source-conflict'); assert.equal(host.text, external); assert.equal(host.writes, 1);
        assert.equal(coordinator.history.canUndo, true); assert.equal(coordinator.history.canRedo, false);
        await coordinator.refresh(); assert.equal(coordinator.history.canUndo, false);
    });
    for (const mode of ['before', 'after', 'mismatch']) await test(`IO failure ${mode} never triggers destructive rollback`, async () => {
        const { host, coordinator } = create(), original = coordinator.document, tx = rename(coordinator);
        host.failure = mode;
        await assert.rejects(coordinator.commit(tx));
        assert.equal(coordinator.document, original); assert.equal(coordinator.history.canUndo, false); assert.equal(coordinator.needsRefresh, true);
        assert.equal(host.text, mode === 'before' ? tx.before.text : tx.after.text);
        assert.equal(host.writes, mode === 'before' ? 0 : 1);
        host.failure = null; await coordinator.refresh();
        await coordinator.commit(rename(coordinator, 'Recovered')); assert.ok(host.text.startsWith('# Recovered'));
    });
    await test('new transaction after undo clears redo; same text rename does not add history', async () => {
        const { coordinator } = create(); await coordinator.commit(rename(coordinator, 'A'));
        assert.equal(coordinator.history.canUndo, false);
        await coordinator.commit(rename(coordinator)); await coordinator.undo();
        assert.equal(coordinator.history.canRedo, true); await coordinator.commit(rename(coordinator, 'Different'));
        assert.equal(coordinator.history.canRedo, false);
    });
    await test('history is bounded and snapshots never enter plugin persistence', async () => {
        const history = new engine.StructureHistory(2), { coordinator } = create();
        for (const title of ['One', 'Two', 'Three']) {
            const tx = rename(coordinator, title); history.record(tx); await coordinator.commit(tx);
        }
        history.didUndo(); history.didUndo(); assert.equal(history.canUndo, false); assert.equal(history.canRedo, true);
        const tiny = new engine.StructureHistory(100, 1); tiny.record(rename(coordinator, 'Big')); assert.equal(tiny.canUndo, false);
    });
    await test('mutated plan text cannot bypass candidate validation', async () => {
        const { host, coordinator } = create(), tx = rename(coordinator);
        const forged = { ...tx, after: { ...tx.after, text: '# Lost everything' } };
        await fails(coordinator.commit(forged), 'invalid-transaction'); assert.equal(host.writes, 0);
    });
    await test('rename notification changes only source path and retires old history', async () => {
        const { host, coordinator } = create();
        await coordinator.commit(rename(coordinator));
        const before = host.text, ids = [...coordinator.document.order], writes = host.writes;
        await coordinator.relocate('Renamed.md');
        assert.equal(coordinator.document.sourcePath, 'Renamed.md');
        assert.deepEqual(coordinator.document.order, ids); assert.equal(host.text, before); assert.equal(host.writes, writes);
        assert.ok([...coordinator.document.sections.values()].every(section => section.sourcePath === 'Renamed.md'));
        assert.equal(coordinator.history.canUndo, false);
        await coordinator.commit(rename(coordinator, 'After rename')); assert.ok(host.text.includes('After rename'));
    });
    await test('rename plus external edit blocks writes but refresh uses new path', async () => {
        const { host, coordinator } = create(); host.text += '\n# External\n';
        await fails(coordinator.relocate('New path.md'), 'source-conflict');
        assert.equal(coordinator.document.sourcePath, 'New path.md'); assert.equal(coordinator.needsRefresh, true);
        await coordinator.refresh(); assert.ok(coordinator.document.text.includes('External')); assert.equal(host.writes, 0);
    });
    console.log(`Document conflicts and history: ${count} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
