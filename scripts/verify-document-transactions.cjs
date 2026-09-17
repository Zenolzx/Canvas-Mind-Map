const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { assert, engine, service, parse, section, titles, body, apply, error } = require('./document-test-utils.cjs');
let count = 0;
function test(name, run) { try { run(); count++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } }
const id = (doc, title, occurrence) => section(doc, title, occurrence).id;

test('rename B changes title only, retains closing syntax and all IDs', () => {
    const text = '\uFEFF# A\r\n\r\n  ## B ###  \r\nbody  \r\n### C\r\nchild';
    const doc = parse(text), after = apply(doc, { type: 'rename', nodeId: id(doc, 'B'), title: '# 中文 🚀' });
    assert.equal(after.text, text.replace('B ###', '中文 🚀 ###'));
    assert.deepEqual(after.order, doc.order); assert.equal(body(after, '中文 🚀'), body(doc, 'B'));
});
test('rename Setext retains original underline', () => {
    const doc = parse('Foo\n==========\n\nbody');
    assert.equal(apply(doc, { type: 'rename', nodeId: id(doc, 'Foo'), title: 'Bar' }).text, 'Bar\n==========\n\nbody');
});
for (const [source, expected] of [['#', '# Foo'], ['## ###\n', '## Foo ###\n'], ['##   \n', '##   Foo\n']])
    test(`rename empty heading ${JSON.stringify(source)}`, () => {
        const doc = parse(source); assert.equal(apply(doc, { type: 'rename', nodeId: doc.order[0], title: 'Foo' }).text, expected);
    });
test('reject multiline, empty and structurally ambiguous titles', () => {
    const doc = parse('# A\n');
    error(() => apply(doc, { type: 'rename', nodeId: doc.order[0], title: 'A\n# Injected' }), 'invalid-title');
    error(() => apply(doc, { type: 'rename', nodeId: doc.order[0], title: '# ' }), 'empty-title');
    error(() => apply(doc, { type: 'rename', nodeId: doc.order[0], title: 'Foo ###' }), 'unexpected-structure');
});
test('insert sibling after entire subtree, child as last child', () => {
    const doc = parse('# A\nintro\n## B\nbody\n### C\nchild\n# D\n');
    const sibling = apply(doc, { type: 'insertSibling', nodeId: id(doc, 'A'), title: 'Next' });
    assert.equal(sibling.text, '# A\nintro\n## B\nbody\n### C\nchild\n# Next\n# D\n');
    const child = apply(doc, { type: 'insertChild', nodeId: id(doc, 'A'), title: 'Last' });
    assert.equal(child.text, '# A\nintro\n## B\nbody\n### C\nchild\n## Last\n# D\n');
    assert.equal(body(child, 'A'), body(doc, 'A'));
});
test('insert sibling before current subtree', () => {
    const doc = parse('# A\n## B\n### C\n');
    assert.equal(apply(doc, { type: 'insertSibling', nodeId: id(doc, 'B'), position: 'before', title: 'New' }).text,
        '# A\n## New\n## B\n### C\n');
});
test('first section preserves BOM frontmatter and all unsectioned prose', () => {
    for (const text of ['', 'Intro without final newline', '\uFEFF', '\uFEFF---\r\ntitle: X\r\n---\r\nIntro']) {
        const doc = parse(text), after = apply(doc, { type: 'insertChild', nodeId: 'document', title: 'Introduction' });
        assert.ok(after.text.startsWith(text)); assert.deepEqual(titles(after), ['Introduction']);
        assert.equal(section(after, 'Introduction').headingLevel, 1);
    }
});
test('Article outline scenarios A/B/C', () => {
    let doc = parse('');
    for (const title of ['Introduction', 'Background', 'Method', 'Results', 'Conclusion'])
        doc = apply(doc, { type: 'insertChild', nodeId: 'document', title });
    doc = apply(doc, { type: 'insertChild', nodeId: id(doc, 'Method'), title: 'Architecture' });
    doc = apply(doc, { type: 'insertSibling', nodeId: id(doc, 'Architecture'), title: 'Training' });
    doc = apply(doc, { type: 'rename', nodeId: id(doc, 'Architecture'), title: 'System Architecture' });
    assert.equal(doc.text, '# Introduction\n# Background\n# Method\n## System Architecture\n## Training\n# Results\n# Conclusion\n');
});
test('delete leaf and entire subtree preserve surrounding bytes', () => {
    const doc = parse('# A\nintro\n## B\nbody\n### C\nchild\n## D\nend');
    assert.equal(apply(doc, { type: 'delete', nodeId: id(doc, 'C'), strategy: 'subtree' }).text, '# A\nintro\n## B\nbody\n## D\nend');
    assert.equal(apply(doc, { type: 'delete', nodeId: id(doc, 'B'), strategy: 'subtree' }).text, '# A\nintro\n## D\nend');
});
test('remove heading promotes children and preserves direct body in preceding section', () => {
    const doc = parse('# A\nintro\n## B\nKEEP\n#### C\nbody\n##### D\nchild\n## E\n');
    const after = apply(doc, { type: 'delete', nodeId: id(doc, 'B'), strategy: 'promoteChildren' });
    assert.equal(after.text, '# A\nintro\nKEEP\n## C\nbody\n### D\nchild\n## E\n');
    assert.equal(body(after, 'A'), 'intro\nKEEP\n');
});
test('removing first heading keeps body in document introduction', () => {
    const doc = parse('# A\nKEEP\n## B\nbody\n');
    const after = apply(doc, { type: 'delete', nodeId: id(doc, 'A'), strategy: 'promoteChildren' });
    assert.equal(after.text, 'KEEP\n# B\nbody\n');
    assert.equal(after.text.slice(after.introduction.start, after.introduction.end), 'KEEP\n');
});
test('promote skipped levels moves after parent subtree, preserving descendant deltas', () => {
    const doc = parse('## A\n#### B\nB body\n###### C\nC body\n### D\nD body\n## E\n');
    const after = apply(doc, { type: 'promote', nodeId: id(doc, 'B') });
    assert.equal(after.text, '## A\n### D\nD body\n## B\nB body\n#### C\nC body\n## E\n');
    assert.equal(section(after, 'B').parentId, 'document');
});
test('demote to previous sibling as last child', () => {
    const doc = parse('# A\nintro\n## Existing\nbody\n# B\nB body\n## C\nchild\n# D\n');
    const after = apply(doc, { type: 'demote', nodeId: id(doc, 'B') });
    assert.equal(after.text, '# A\nintro\n## Existing\nbody\n## B\nB body\n### C\nchild\n# D\n');
});
test('move before and after H2 updates order independently of heading names', () => {
    const doc = parse('# A\n## B\nB\n### C\nC\n## D\nD\n## E\nE\n');
    assert.equal(apply(doc, { type: 'moveBefore', nodeId: id(doc, 'E'), targetId: id(doc, 'B') }).text,
        '# A\n## E\nE\n## B\nB\n### C\nC\n## D\nD\n');
    assert.equal(apply(doc, { type: 'moveAfter', nodeId: id(doc, 'B'), targetId: id(doc, 'D') }).text,
        '# A\n## D\nD\n## B\nB\n### C\nC\n## E\nE\n');
});
test('move subtree to another parent transforms every heading', () => {
    const doc = parse('# A\n## B\nB body\n### C\nC body\n# D\n## E\nE body\n');
    const after = apply(doc, { type: 'move', nodeId: id(doc, 'B'), parentId: id(doc, 'E'), index: 0 });
    assert.equal(after.text, '# A\n# D\n## E\nE body\n### B\nB body\n#### C\nC body\n');
    assert.equal(section(after, 'B').parentId, id(doc, 'E')); assert.equal(body(after, 'C'), 'C body\n');
});
test('move index counts destination children after source removal', () => {
    const doc = parse('# A\n## B\n## C\n## D\n');
    const after = apply(doc, { type: 'move', nodeId: id(doc, 'B'), parentId: id(doc, 'A'), index: 2 });
    assert.deepEqual(titles(after), ['A', 'C', 'D', 'B']);
});
test('rich body moves without reserialization', () => {
    const doc = parse(fs.readFileSync('scripts/fixtures/document-structure/rich.md', 'utf8'));
    const after = apply(doc, { type: 'move', nodeId: id(doc, 'Architecture'), parentId: id(doc, 'Evaluation'), index: 0 });
    for (const title of ['Architecture', 'Model', 'Tools', 'Execution']) assert.equal(body(after, title), body(doc, title));
    assert.equal(section(after, 'Architecture').headingLevel, 3);
    assert.equal(section(after, 'Execution').headingLevel, 5);
    assert.equal(after.text.slice(0, doc.frontmatter.end), doc.text.slice(0, doc.frontmatter.end));
});
test('duplicate empty titles target exact IDs across rename and move', () => {
    let doc = parse('# A\n## Repeat\n## Repeat\n## Repeat\n');
    const chosen = id(doc, 'Repeat', 1), first = id(doc, 'Repeat', 0);
    doc = apply(doc, { type: 'rename', nodeId: chosen, title: '中文 😀' });
    doc = apply(doc, { type: 'moveBefore', nodeId: chosen, targetId: first });
    assert.deepEqual(titles(doc), ['A', '中文 😀', 'Repeat', 'Repeat']); assert.equal(id(doc, '中文 😀'), chosen);
});
test('H6 overflow checks deepest descendant before editing', () => {
    const doc = parse('# A\n## B\n###### Deep\n# C\n## D\n');
    error(() => apply(doc, { type: 'move', nodeId: id(doc, 'B'), parentId: id(doc, 'D'), index: 0 }), 'heading-level-limit');
    error(() => apply(doc, { type: 'insertChild', nodeId: id(doc, 'Deep'), title: 'Invalid' }), 'heading-level-limit');
    const h6 = parse('##### A\n###### B\n###### C\n');
    error(() => apply(h6, { type: 'demote', nodeId: id(h6, 'C') }), 'heading-level-limit');
});
test('illegal destinations and root operations fail before writer', () => {
    const doc = parse('# A\n## B\n### C\n# D\n');
    error(() => apply(doc, { type: 'move', nodeId: id(doc, 'A'), parentId: id(doc, 'C'), index: 0 }), 'cycle');
    error(() => apply(doc, { type: 'moveBefore', nodeId: id(doc, 'B'), targetId: id(doc, 'B') }), 'self-move');
    error(() => apply(doc, { type: 'promote', nodeId: id(doc, 'A') }), 'cannot-promote');
    error(() => apply(doc, { type: 'demote', nodeId: id(doc, 'B') }), 'cannot-demote');
    error(() => apply(doc, { type: 'rename', nodeId: 'document', title: 'File' }), 'invalid-target');
    error(() => apply(doc, { type: 'delete', nodeId: 'document', strategy: 'subtree' }), 'invalid-target');
    error(() => apply(doc, { type: 'move', nodeId: id(doc, 'B'), parentId: 'document', index: 99 }), 'invalid-index');
});
test('missing EOF newline is separated safely during insert and move', () => {
    const doc = parse('# A\nA body\n# B\nB body');
    assert.equal(apply(doc, { type: 'insertSibling', nodeId: id(doc, 'B'), title: 'C' }).text, '# A\nA body\n# B\nB body\n# C\n');
    assert.equal(apply(doc, { type: 'moveBefore', nodeId: id(doc, 'B'), targetId: id(doc, 'A') }).text, '# B\nB body\n# A\nA body\n');
});
test('Setext to H3 conversion changes only heading representation', () => {
    const doc = parse('# A\n## B\nB body\n\nTitle\n=====\n\nOriginal body  \n');
    const after = apply(doc, { type: 'move', nodeId: id(doc, 'Title'), parentId: id(doc, 'B'), index: 0 });
    assert.equal(after.text, '# A\n## B\nB body\n\n### Title\n\nOriginal body  \n');
    assert.equal(body(after, 'Title'), body(doc, 'Title'));
});
test('update body leaves heading descendants and other sections untouched', () => {
    const doc = parse('# A\nold\n## B\nchild\n# C\nend\n');
    const transaction = service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: '\nNew **body**\n\n' });
    assert.equal(transaction.after.text, '# A\n\nNew **body**\n\n## B\nchild\n# C\nend\n');
    assert.equal(transaction.changeKind, 'body'); assert.deepEqual(transaction.after.order, doc.order);
});
test('body headings create nodes and selection follows supplied cursor', () => {
    const doc = parse('# A\nold\n## Existing\nchild\n');
    const markdown = 'intro\n## Dataset\nnew body\n';
    const tx = service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown, cursorOffset: markdown.length - 1 });
    assert.deepEqual(titles(tx.after), ['A', 'Dataset', 'Existing']); assert.equal(tx.changeKind, 'structure');
    assert.equal(tx.selection.nodeId, id(tx.after, 'Dataset')); assert.equal(body(tx.after, 'Existing'), 'child\n');
});
test('body cursor at replacement end does not jump into following untouched child', () => {
    const doc = parse('# A\nold\n## Existing\nbody\n');
    const tx = service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: 'New\n' });
    assert.equal(tx.selection.nodeId, id(doc, 'A'));
    const newHeading = service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: 'New\n## Dataset\ndata\n' });
    assert.equal(newHeading.selection.nodeId, id(newHeading.after, 'Dataset'));
});
test('body cursor accounts for a missing heading line terminator', () => {
    const doc = parse('# A');
    const tx = service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: '## Dataset\ntext', cursorOffset: 0 });
    assert.equal(tx.selection.nodeId, id(tx.after, 'Dataset')); assert.equal(tx.selection.bodyOffset, 0);
    error(() => service.prepare(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: 'x', cursorOffset: NaN }), 'invalid-cursor');
});
test('edit introduction does not expose frontmatter to editor', () => {
    const doc = parse('---\ntitle: X\n---\nold intro\n# A\nbody\n');
    const after = apply(doc, { type: 'updateBody', nodeId: 'introduction', markdown: 'New intro' });
    assert.equal(after.text, '---\ntitle: X\n---\nNew intro\n# A\nbody\n');
});
test('empty EOF heading can acquire body without corrupting its title', () => {
    const doc = parse('# A');
    const after = apply(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: 'Body' });
    assert.equal(after.text, '# A\nBody'); assert.equal(body(after, 'A'), 'Body');
});
test('body edit cannot swallow existing children into an unclosed block', () => {
    const doc = parse('# A\nold\n## B\nchild\n');
    assert.throws(() => apply(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: '```\n' }), e => ['unsupported-source', 'unexpected-structure'].includes(e.code));
    assert.equal(doc.text, '# A\nold\n## B\nchild\n');
});
test('boundary reinterpretation is rejected rather than silently absorbing a Setext title', () => {
    const doc = parse('# A\nparagraph\n\nTitle\n=====\nbody\n');
    assert.throws(() => apply(doc, { type: 'updateBody', nodeId: id(doc, 'A'), markdown: 'paragraph\n' }),
        e => ['unsupported-source', 'unexpected-structure'].includes(e.code));
});
test('seeded reorder operations preserve every rich direct body and exact identity', () => {
    let doc = parse('# Root\n' + Array.from({ length: 30 }, (_, i) => `## N${i}\n\nBody ${i} 中文 **x**  \n\n\x60\x60\x60md\n# Code ${i}\n\x60\x60\x60\n\n`).join(''));
    const original = new Map(doc.order.map(key => [key, body(doc, doc.sections.get(key).headingText)]));
    let seed = 42;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < 150; i++) {
        const a = 1 + random() % 30, b = 1 + random() % 30;
        if (a === b) continue;
        doc = apply(doc, { type: i % 2 ? 'moveBefore' : 'moveAfter', nodeId: doc.order[a], targetId: doc.order[b] });
        for (const [key, text] of original) {
            const s = doc.sections.get(key); assert.ok(s); assert.equal(doc.text.slice(s.body.start, s.body.end), text);
        }
    }
});
for (const size of [50, 200, 500]) test(`${size} headings with long bodies`, () => {
    const text = '# Root\n' + Array.from({ length: size - 1 }, (_, i) => `## N${i}\n${('中文 body **bold** ' + i + '\n').repeat(30)}\n`).join('');
    const started = performance.now(), doc = parse(text);
    const after = apply(doc, { type: 'moveBefore', nodeId: doc.order[size - 1], targetId: doc.order[1] });
    assert.equal(after.sections.size, size);
    assert.equal(body(after, `N${size - 2}`), body(doc, `N${size - 2}`));
    console.log(`  ${size} headings / ${text.length} UTF-16 units: parse + move + validate ${(performance.now() - started).toFixed(1)} ms`);
});
console.log(`Document transactions: ${count} checks passed.`);
