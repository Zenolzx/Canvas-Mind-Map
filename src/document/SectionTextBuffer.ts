/** Editor coordinates use UTF-16 and LF; source text retains its original line endings. */
export interface SectionTextChange {
    from: number;
    to: number;
    insert: string;
}

export function normalizeEditorText(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

/** Immutable adapter for changes expressed against one editor snapshot.
 * Keep this in memory only. It is not a second document or a file writer.
 */
export class SectionTextBuffer {
    readonly editorText: string;
    private readonly crlfEnds: number[] = [];

    constructor(readonly sourceText: string, readonly insertionEol: '\n' | '\r\n' | '\r' = '\n') {
        this.editorText = normalizeEditorText(sourceText);
        let normalizedOffset = 0;
        for (let i = 0; i < sourceText.length; i++, normalizedOffset++) {
            if (sourceText[i] === '\r' && sourceText[i + 1] === '\n') {
                this.crlfEnds.push(normalizedOffset + 1);
                i++;
            }
        }
    }

    sourceOffset(editorOffset: number): number {
        if (!Number.isInteger(editorOffset) || editorOffset < 0 || editorOffset > this.editorText.length) {
            throw new RangeError('Invalid section editor offset');
        }
        let low = 0;
        let high = this.crlfEnds.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (this.crlfEnds[mid] <= editorOffset) low = mid + 1;
            else high = mid;
        }
        return editorOffset + low;
    }

    /** expectedEditorText rejects changes prepared from an obsolete buffer.
     * Changes must be ordered, non-overlapping, and use pre-change coordinates.
     */
    apply(expectedEditorText: string, changes: readonly SectionTextChange[]): SectionTextBuffer {
        if (expectedEditorText !== this.editorText) throw new Error('Section editor snapshot changed');
        let previousEnd = 0;
        let previousFrom = -1;
        let rawCursor = 0;
        const parts: string[] = [];
        for (const change of changes) {
            const start = this.sourceOffset(change.from);
            const end = this.sourceOffset(change.to);
            if (change.to < change.from || change.from < previousEnd || change.from === previousFrom) {
                throw new RangeError('Section changes overlap or are out of order');
            }
            parts.push(this.sourceText.slice(rawCursor, start));
            parts.push(normalizeEditorText(change.insert).replace(/\n/g, this.insertionEol));
            rawCursor = end;
            previousEnd = change.to;
            previousFrom = change.from;
        }
        parts.push(this.sourceText.slice(rawCursor));
        return new SectionTextBuffer(parts.join(''), this.insertionEol);
    }
}
