import { SourceRange, StructureError } from './DocumentStructure';

export interface HeadingAnchor { readonly id: string; readonly offset: number }
export interface TextEdit {
    readonly range: SourceRange;
    readonly expectedText: string;
    readonly replacement: string;
    /** Offsets relative to replacement, for headings explicitly moved or rewritten. */
    readonly anchors?: readonly HeadingAnchor[];
}
export interface WriteResult { text: string; identities: ReadonlyMap<number, string> }

/** Pure source-range writer. No parser, document IO, formatting or UI dependencies. */
export class MarkdownStructureWriter {
    apply(text: string, edits: readonly TextEdit[], anchors: readonly HeadingAnchor[] = []): WriteResult {
        const ordered = [...edits].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
        const identities = new Map<number, string>();
        let cursor = 0, output = '';
        const anchor = (position: number, id: string) => {
            if (identities.has(position)) throw new StructureError('overlapping-identities', 'Two sections cannot occupy the same heading position.');
            identities.set(position, id);
        };
        const copy = (end: number) => {
            for (const item of anchors) if (item.offset >= cursor && item.offset < end)
                anchor(output.length + item.offset - cursor, item.id);
            output += text.slice(cursor, end); cursor = end;
        };
        let previousInsertion = -1;
        for (const edit of ordered) {
            const { start, end } = edit.range;
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || start < 0 || end < start || end > text.length)
                throw new StructureError('invalid-range', 'Text edits must have valid, non-overlapping source ranges.');
            if (start === end && previousInsertion === start) throw new StructureError('ambiguous-insertion', 'Combine insertions at the same position into one edit.');
            previousInsertion = start === end ? start : -1;
            if (text.slice(start, end) !== edit.expectedText) throw new StructureError('stale-range', 'The source range no longer matches the transaction.');
            copy(start);
            for (const item of edit.anchors ?? []) {
                if (!Number.isInteger(item.offset) || item.offset < 0 || item.offset >= edit.replacement.length)
                    throw new StructureError('invalid-anchor', 'Heading anchor is outside its replacement.');
                anchor(output.length + item.offset, item.id);
            }
            output += edit.replacement; cursor = end;
        }
        copy(text.length);
        if (new Set(identities.values()).size !== identities.size) throw new StructureError('duplicate-identity', 'A section cannot be duplicated by an edit.');
        return { text: output, identities };
    }
}
