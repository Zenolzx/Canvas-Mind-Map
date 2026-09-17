/** All positions are UTF-16 offsets into the exact source string; ranges are [start, end). */
export interface SourceRange { readonly start: number; readonly end: number }
export type SectionId = string;
export const DOCUMENT_ROOT = 'document';
export const DOCUMENT_INTRODUCTION = 'introduction';

export interface DocumentSection {
    readonly id: SectionId;
    readonly headingText: string;
    readonly headingLevel: number;
    readonly headingStyle: 'atx' | 'setext';
    readonly heading: SourceRange;
    readonly title: SourceRange;
    readonly marker: SourceRange;
    readonly body: SourceRange;
    readonly subtree: SourceRange;
    readonly parentId: SectionId;
    readonly children: readonly SectionId[];
    readonly sourcePath: string;
    readonly line: number;
    readonly depth: number;
}

export interface StructureDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly range: SourceRange;
}

/** Runtime snapshot only. Never persist source text or history in plugin data. */
export interface DocumentStructure {
    readonly sourcePath: string;
    readonly revision: number;
    readonly text: string;
    readonly rootId: typeof DOCUMENT_ROOT;
    readonly bom: SourceRange;
    readonly frontmatter: SourceRange | null;
    readonly introduction: SourceRange;
    readonly sections: ReadonlyMap<SectionId, DocumentSection>;
    readonly order: readonly SectionId[];
    readonly roots: readonly SectionId[];
    readonly diagnostics: readonly StructureDiagnostic[];
    readonly defaultEol: string;
}

export class StructureError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'StructureError'; }
}

export function requireSection(doc: DocumentStructure, id: SectionId): DocumentSection {
    const section = doc.sections.get(id);
    if (!section) throw new StructureError('invalid-target', 'The selected section no longer exists. Refresh and select it again.');
    return section;
}

export function subtreeSections(doc: DocumentStructure, id: SectionId): DocumentSection[] {
    const root = requireSection(doc, id);
    return doc.order.map(key => doc.sections.get(key)!).filter(s =>
        s.heading.start >= root.subtree.start && s.heading.start < root.subtree.end);
}

export function assertEditable(doc: DocumentStructure): void {
    if (doc.diagnostics.length) throw new StructureError('unsupported-source', doc.diagnostics[0].message);
}
