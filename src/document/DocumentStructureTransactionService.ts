import { assertEditable, DOCUMENT_INTRODUCTION, DOCUMENT_ROOT, DocumentSection, DocumentStructure, requireSection,
    SourceRange, StructureError, subtreeSections } from './DocumentStructure';
import { DocumentStructureParser, newSectionId } from './DocumentStructureParser';
import { HeadingAnchor, MarkdownStructureWriter, TextEdit } from './MarkdownStructureWriter';
import { StructureOperation, StructureSelection } from './StructureOperation';
import { ExpectedSection, StructureValidator, TransactionExpectation } from './StructureValidator';

export interface PreparedTransaction {
    readonly operation: StructureOperation;
    readonly before: DocumentStructure;
    readonly after: DocumentStructure;
    readonly edits: readonly TextEdit[];
    readonly identityMap: ReadonlyMap<string, string>;
    readonly selection: StructureSelection;
    readonly changeKind: 'body' | 'structure';
}

export function normalizeHeadingTitle(value: string): string {
    if (/[\r\n\u0000]/.test(value)) throw new StructureError('invalid-title', 'A heading title must be a single line without NUL characters.');
    const title = value.trim().replace(/^#{1,6}(?:[\t ]+|$)/, '').trim();
    if (!title) throw new StructureError('empty-title', 'Enter a heading title before committing the draft.');
    return title;
}

/** Plans and validates all edits in memory. It never opens or writes a file. */
export class DocumentStructureTransactionService {
    constructor(readonly parser = new DocumentStructureParser(), private writer = new MarkdownStructureWriter(),
        private validator = new StructureValidator()) {}

    prepare(doc: DocumentStructure, operation: StructureOperation): PreparedTransaction {
        assertEditable(doc); this.validator.document(doc);
        let edits: TextEdit[] = [], order = [...doc.order];
        const expected = new Map<string, ExpectedSection>(doc.order.map(id => {
            const s = doc.sections.get(id)!;
            return [id, { title: s.headingText, level: s.headingLevel, parentId: s.parentId }];
        }));
        let selected = operation.nodeId, allowNewHeadings = false, allowReparenting = false;
        const edit = (range: SourceRange, replacement: string, anchors?: HeadingAnchor[]): TextEdit =>
            ({ range, expectedText: doc.text.slice(range.start, range.end), replacement, anchors });
        const headingEdit = (s: DocumentSection, replacement: string): TextEdit => edit(s.heading, replacement, [{ id: s.id, offset: 0 }]);
        const siblings = (parentId: string) => parentId === DOCUMENT_ROOT ? [...doc.roots] : [...requireSection(doc, parentId).children];

        const insert = (position: number, level: number, parentId: string, title: string) => {
            this.checkLevel(level);
            const id = newSectionId(), text = `${'#'.repeat(level)} ${normalizeHeadingTitle(title)}${doc.defaultEol}`;
            const prefix = this.insertionPrefix(doc.text, position, doc.defaultEol);
            edits.push(edit({ start: position, end: position }, prefix + text, [{ id, offset: prefix.length }]));
            const index = order.findIndex(key => doc.sections.get(key)!.heading.start >= position);
            order.splice(index < 0 ? order.length : index, 0, id);
            expected.set(id, { title: normalizeHeadingTitle(title), level, parentId }); selected = id;
        };

        const move = (id: string, parentId: string, index: number, targetLevel?: number) => {
            const source = requireSection(doc, id), subtree = subtreeSections(doc, id), moved = new Set(subtree.map(s => s.id));
            if (moved.has(parentId)) throw new StructureError('cycle', 'A section cannot be moved into itself or its descendants.');
            const parent = parentId === DOCUMENT_ROOT ? undefined : requireSection(doc, parentId);
            const children = siblings(parentId).filter(key => key !== id);
            if (!Number.isInteger(index) || index < 0 || index > children.length)
                throw new StructureError('invalid-index', 'The destination index is outside the parent.');
            const level = targetLevel ?? (parent ? parent.headingLevel + 1 : 1), delta = level - source.headingLevel;
            subtree.forEach(s => this.checkLevel(s.headingLevel + delta));
            const position = index < children.length ? requireSection(doc, children[index]).heading.start :
                children.length ? requireSection(doc, children[children.length - 1]).subtree.end : parent?.body.end ?? doc.text.length;
            if (position > source.subtree.start && position < source.subtree.end)
                throw new StructureError('cycle', 'The destination is inside the section being moved.');
            const localEdits: TextEdit[] = delta ? subtree.map(s => ({
                range: { start: s.heading.start - source.subtree.start, end: s.heading.end - source.subtree.start },
                expectedText: doc.text.slice(s.heading.start, s.heading.end), replacement: this.levelHeading(doc, s, s.headingLevel + delta),
                anchors: [{ id: s.id, offset: 0 }],
            })) : [];
            const fragment = this.writer.apply(doc.text.slice(source.subtree.start, source.subtree.end), localEdits,
                subtree.map(s => ({ id: s.id, offset: s.heading.start - source.subtree.start })));
            if (position === source.subtree.start || position === source.subtree.end) {
                edits.push(edit(source.subtree, fragment.text, Array.from(fragment.identities, ([offset, id]) => ({ id, offset }))));
            } else {
                const prefix = this.insertionPrefix(doc.text, position, doc.defaultEol);
                // A final section without a newline must not join the following heading.
                const suffix = position < doc.text.length && !/[\r\n]$/.test(fragment.text) ? doc.defaultEol : '';
                edits.push(edit(source.subtree, ''));
                edits.push(edit({ start: position, end: position }, prefix + fragment.text + suffix,
                    Array.from(fragment.identities, ([offset, id]) => ({ id, offset: offset + prefix.length }))));
            }
            order = order.filter(key => !moved.has(key));
            const before = index < children.length ? children[index] : undefined;
            let destination: number;
            if (before) destination = order.indexOf(before);
            else if (parent) {
                destination = order.indexOf(parent.id) + 1;
                while (destination < order.length && requireSection(doc, order[destination]).heading.start < parent.subtree.end) destination++;
            } else destination = order.length;
            order.splice(destination, 0, ...subtree.map(s => s.id));
            for (const s of subtree) expected.get(s.id)!.level += delta;
            expected.get(id)!.parentId = parentId;
        };

        switch (operation.type) {
            case 'rename': {
                const s = requireSection(doc, operation.nodeId), title = normalizeHeadingTitle(operation.title);
                let prefix = doc.text.slice(s.heading.start, s.title.start), suffix = doc.text.slice(s.title.end, s.heading.end);
                if (s.headingStyle === 'atx' && !/[\t ]$/.test(prefix)) prefix += ' ';
                if (s.headingStyle === 'atx' && !s.headingText && /^#/.test(suffix)) suffix = ' ' + suffix;
                edits.push(headingEdit(s, prefix + title + suffix)); expected.get(s.id)!.title = title;
                break;
            }
            case 'insertChild': {
                if (operation.nodeId === DOCUMENT_ROOT) insert(doc.text.length, 1, DOCUMENT_ROOT, operation.title);
                else {
                    const s = requireSection(doc, operation.nodeId);
                    insert(s.subtree.end, s.headingLevel + 1, s.id, operation.title);
                }
                break;
            }
            case 'insertSibling': {
                const s = requireSection(doc, operation.nodeId);
                insert(operation.position === 'before' ? s.heading.start : s.subtree.end, s.headingLevel, s.parentId, operation.title);
                break;
            }
            case 'delete': {
                const s = requireSection(doc, operation.nodeId);
                if (operation.strategy === 'subtree') {
                    edits.push(edit(s.subtree, ''));
                    for (const item of subtreeSections(doc, s.id)) { expected.delete(item.id); order = order.filter(id => id !== item.id); }
                } else if (operation.strategy === 'promoteChildren') {
                    edits.push(edit(s.heading, '')); expected.delete(s.id); order = order.filter(id => id !== s.id);
                    // Each child becomes a sibling of the removed heading, even in skipped-level documents.
                    for (const childId of s.children) {
                        const child = requireSection(doc, childId), delta = s.headingLevel - child.headingLevel;
                        for (const item of subtreeSections(doc, childId)) {
                            const level = item.headingLevel + delta; this.checkLevel(level);
                            edits.push(headingEdit(item, this.levelHeading(doc, item, level))); expected.get(item.id)!.level = level;
                        }
                        expected.get(childId)!.parentId = s.parentId;
                    }
                } else throw new StructureError('invalid-strategy', 'Choose an explicit deletion strategy.');
                const parent = s.parentId === DOCUMENT_ROOT ? DOCUMENT_ROOT : s.parentId;
                selected = s.children.find(id => expected.has(id)) ?? parent;
                break;
            }
            case 'move': move(operation.nodeId, operation.parentId, operation.index); break;
            case 'moveBefore':
            case 'moveAfter': {
                if (operation.nodeId === operation.targetId) throw new StructureError('self-move', 'A section cannot be dropped onto itself.');
                const target = requireSection(doc, operation.targetId);
                const list = siblings(target.parentId).filter(id => id !== operation.nodeId);
                move(operation.nodeId, target.parentId, list.indexOf(target.id) + (operation.type === 'moveAfter' ? 1 : 0), target.headingLevel);
                break;
            }
            case 'promote': {
                const s = requireSection(doc, operation.nodeId);
                if (s.parentId === DOCUMENT_ROOT) throw new StructureError('cannot-promote', 'A top-level section has no parent to promote out of.');
                const parent = requireSection(doc, s.parentId);
                move(s.id, parent.parentId, siblings(parent.parentId).indexOf(parent.id) + 1, parent.headingLevel);
                break;
            }
            case 'demote': {
                const s = requireSection(doc, operation.nodeId), list = siblings(s.parentId), index = list.indexOf(s.id);
                if (index <= 0) throw new StructureError('cannot-demote', 'There is no previous sibling to become the parent.');
                const parent = requireSection(doc, list[index - 1]);
                move(s.id, parent.id, parent.children.length);
                break;
            }
            case 'updateBody': {
                if (operation.markdown.includes('\u0000')) throw new StructureError('invalid-body', 'NUL characters cannot be written to a section.');
                if (operation.cursorOffset !== undefined && (!Number.isInteger(operation.cursorOffset) || operation.cursorOffset < 0 || operation.cursorOffset > operation.markdown.length))
                    throw new StructureError('invalid-cursor', 'The editor cursor must be inside the replacement body.');
                const range = operation.nodeId === DOCUMENT_INTRODUCTION ? doc.introduction : requireSection(doc, operation.nodeId).body;
                // An empty EOF heading has no terminator yet. Separate the first body character.
                const prefix = range.start === range.end && range.start === doc.text.length && operation.nodeId !== DOCUMENT_INTRODUCTION &&
                    !/[\r\n]$/.test(doc.text) && operation.markdown ? doc.defaultEol : '';
                const suffix = range.end < doc.text.length && operation.markdown && !/[\r\n]$/.test(operation.markdown) ? doc.defaultEol : '';
                edits.push(edit(range, prefix + operation.markdown + suffix));
                allowNewHeadings = true; allowReparenting = true;
                break;
            }
            default: throw new StructureError('invalid-operation', 'Unknown structure operation.');
        }
        const result = this.writer.apply(doc.text, edits, doc.order.map(id => ({ id, offset: doc.sections.get(id)!.heading.start })));
        const after = this.parser.parse(result.text, { sourcePath: doc.sourcePath, revision: doc.revision + 1, identities: result.identities });
        const expectation: TransactionExpectation = { sections: expected, order, allowNewHeadings, allowReparenting };
        this.validator.transaction(doc, after, expectation);
        // Caller may supply an editor cursor; map it into the section created by typing a heading.
        let bodyOffset: number | undefined;
        if (operation.type === 'updateBody') {
            const range = operation.nodeId === DOCUMENT_INTRODUCTION ? doc.introduction : requireSection(doc, operation.nodeId).body;
            const prefixLength = range.start === range.end && range.start === doc.text.length && operation.nodeId !== DOCUMENT_INTRODUCTION &&
                !/[\r\n]$/.test(doc.text) && operation.markdown ? doc.defaultEol.length : 0;
            const insertedStart = range.start + prefixLength, insertedEnd = insertedStart + operation.markdown.length;
            const cursor = insertedStart + (operation.cursorOffset ?? operation.markdown.length);
            // At the end of a body, a following untouched heading is not the user's caret target.
            selected = operation.nodeId;
            for (const id of after.order) {
                const start = after.sections.get(id)!.heading.start;
                if (start >= insertedStart && start < insertedEnd && start <= cursor) selected = id;
            }
            const bodyStart = selected === DOCUMENT_INTRODUCTION ? after.introduction.start : after.sections.get(selected)!.body.start;
            bodyOffset = Math.max(0, cursor - bodyStart);
        }
        const signature = (document: DocumentStructure) => JSON.stringify(document.order.map(id => {
            const s = document.sections.get(id)!; return [id, s.headingText, s.headingLevel, s.parentId];
        }));
        return Object.freeze({ operation: Object.freeze({ ...operation }), before: doc, after,
            edits: Object.freeze(edits.map(e => Object.freeze(e))),
            identityMap: new Map(doc.order.filter(id => after.sections.has(id)).map(id => [id, id])),
            selection: Object.freeze({ nodeId: selected, bodyOffset }), changeKind: signature(doc) === signature(after) ? 'body' : 'structure' });
    }

    private checkLevel(level: number): void {
        if (level < 1 || level > 6) throw new StructureError('heading-level-limit', 'This operation would move a heading outside H1–H6.');
    }

    private insertionPrefix(text: string, position: number, eol: string): string {
        if (position === 0 || (position === 1 && text.charCodeAt(0) === 0xFEFF)) return '';
        return /[\r\n]$/.test(text.slice(0, position)) ? '' : eol;
    }

    private levelHeading(doc: DocumentStructure, section: DocumentSection, level: number): string {
        const original = doc.text.slice(section.heading.start, section.heading.end);
        if (section.headingStyle === 'atx' || level <= 2) {
            const marker = section.headingStyle === 'atx' ? '#'.repeat(level) : (level === 1 ? '=' : '-').repeat(section.marker.end - section.marker.start);
            return original.slice(0, section.marker.start - section.heading.start) + marker + original.slice(section.marker.end - section.heading.start);
        }
        // Setext only represents H1/H2. Convert this heading alone, preserving body bytes.
        const indentation = doc.text.slice(section.heading.start, section.title.start);
        const ending = original.match(/\r\n$|\n$|\r$/)?.[0] ?? '';
        return `${indentation}${'#'.repeat(level)} ${section.headingText}${ending}`;
    }
}
