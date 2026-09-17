import type { MindMapModel, MindMapNode } from '../core/MindMapModel';
import { DOCUMENT_ROOT, DocumentStructure } from './DocumentStructure';

/** Read-only adapter for the existing Organic layout/renderer. No duplicate mutable document model. */
export function projectDocumentMindMap(doc: DocumentStructure, title: string): MindMapModel {
    const lineStarts = [0], endings = /\r\n|\n|\r/g;
    let match: RegExpExecArray | null;
    while ((match = endings.exec(doc.text))) lineStarts.push(match.index + match[0].length);
    const lineAt = (offset: number) => {
        let low = 0, high = lineStarts.length;
        while (low + 1 < high) {
            const middle = (low + high) >>> 1;
            if (lineStarts[middle] <= offset) low = middle; else high = middle;
        }
        return low;
    };
    const nodes: MindMapNode[] = [{ id: DOCUMENT_ROOT, key: '', title, content: '', headingLevel: 0,
        depth: 0, children: [...doc.roots], source: { file: doc.sourcePath, line: 0, endLine: lineAt(doc.text.length) } }];
    for (const id of doc.order) {
        const s = doc.sections.get(id)!;
        nodes.push({ id: s.id, key: s.id, title: s.headingText,
            content: doc.text.slice(s.heading.start, s.body.end), headingLevel: s.headingLevel, depth: s.depth,
            parentId: s.parentId, children: [...s.children], source: { file: doc.sourcePath, line: s.line, endLine: lineAt(s.body.end) } });
    }
    return { rootId: DOCUMENT_ROOT, sourceFile: doc.sourcePath, nodes };
}
