import { assertEditable, DocumentStructure, StructureError } from './DocumentStructure';

export interface ExpectedSection { title: string; level: number; parentId: string }
export interface TransactionExpectation {
    readonly sections: ReadonlyMap<string, ExpectedSection>;
    readonly order: readonly string[];
    readonly allowNewHeadings?: boolean;
    readonly allowReparenting?: boolean;
}

/** Validate intent, not merely that the candidate happens to be parseable. */
export class StructureValidator {
    document(doc: DocumentStructure): void {
        assertEditable(doc);
        let previousEnd = doc.introduction.end;
        if (doc.bom.start !== 0 || doc.bom.end > doc.introduction.start ||
            doc.introduction.start > doc.introduction.end || doc.introduction.end > doc.text.length)
            throw new StructureError('invalid-document', 'Invalid document preamble.');
        for (const id of doc.order) {
            const s = doc.sections.get(id)!;
            const positions = [s.heading.start, s.title.start, s.title.end, s.heading.end, s.body.end, s.subtree.end];
            if (positions.some((p, i) => !Number.isInteger(p) || p < 0 || p > doc.text.length || (i > 0 && p < positions[i - 1])) ||
                s.heading.start !== previousEnd || s.body.start !== s.heading.end || s.subtree.start !== s.heading.start ||
                s.headingLevel < 1 || s.headingLevel > 6)
                throw new StructureError('invalid-document', 'Invalid or overlapping section ranges.');
            previousEnd = s.body.end;
            const parent = doc.sections.get(s.parentId);
            if (parent && (parent.headingLevel >= s.headingLevel || parent.subtree.end < s.subtree.end || !parent.children.includes(id)))
                throw new StructureError('invalid-document', 'Invalid parent/child relationship.');
        }
        if (previousEnd !== doc.text.length) throw new StructureError('invalid-document', 'Document ranges do not cover the source.');
    }

    transaction(before: DocumentStructure, after: DocumentStructure, expected: TransactionExpectation): void {
        this.document(after);
        if (before.sourcePath !== after.sourcePath || after.revision !== before.revision + 1)
            throw new StructureError('invalid-version', 'A transaction must advance exactly one revision of the same note.');
        const protectedEnd = before.frontmatter?.end ?? before.bom.end;
        if (before.text.slice(0, protectedEnd) !== after.text.slice(0, protectedEnd) ||
            before.bom.end !== after.bom.end || (before.frontmatter?.end ?? null) !== (after.frontmatter?.end ?? null))
            throw new StructureError('protected-preamble', 'Structural editing cannot alter BOM or frontmatter.');
        for (const [id, wanted] of expected.sections) {
            const actual = after.sections.get(id);
            if (!actual || actual.headingText !== wanted.title || actual.headingLevel !== wanted.level ||
                (!expected.allowReparenting && actual.parentId !== wanted.parentId))
                throw new StructureError('unexpected-structure', 'The edit would change an unintended section or Markdown block. Operation cancelled.');
        }
        const actualOrder = expected.allowNewHeadings ? after.order.filter(id => expected.sections.has(id)) : after.order;
        if (actualOrder.length !== expected.order.length || actualOrder.some((id, i) => id !== expected.order[i]))
            throw new StructureError('unexpected-structure', 'The edit would lose, duplicate or reorder an unintended heading. Operation cancelled.');
    }
}
