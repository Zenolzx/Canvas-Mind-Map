import { parseHeadings } from './HeadingParser';

export interface MindMapNode {
    id: string;
    key: string;
    title: string;
    content: string;
    headingLevel: number;
    depth: number;
    parentId?: string;
    children: string[];
    source: { file?: string; line: number; endLine: number };
}

/** Document structure only. View state, Canvas IDs and geometry belong to adapters. */
export interface MindMapModel {
    rootId: string;
    nodes: MindMapNode[];
    sourceFile?: string;
}

export function buildMindMapModel(markdown: string, options: {
    title: string; file?: string; promoteSingleRoot?: boolean;
}): MindMapModel {
    const sections = parseHeadings(markdown);
    const promote = options.promoteSingleRoot !== false && sections.filter(s => s.parent < 0).length === 1;
    const nodes: MindMapNode[] = sections.map((section, index) => ({
        id: `heading:${section.key}`, key: section.key, title: section.title, content: section.content,
        headingLevel: section.level, depth: section.depth - (promote ? 1 : 0),
        parentId: promote && index === 0 ? undefined : section.parent < 0 ? 'document' : `heading:${sections[section.parent].key}`,
        children: [], source: { file: options.file, line: section.line, endLine: section.endLine },
    }));
    if (!promote) nodes.unshift({ id: 'document', key: '', title: options.title, content: '', headingLevel: 0,
        depth: 0, children: [], source: { file: options.file, line: 0, endLine: markdown.split(/\r?\n/).length } });
    const lookup = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) if (node.parentId) lookup.get(node.parentId)!.children.push(node.id);
    return { rootId: nodes[0].id, nodes, sourceFile: options.file };
}
