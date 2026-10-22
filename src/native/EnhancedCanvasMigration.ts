import type { AllCanvasNodeData, CanvasData } from 'obsidian/canvas';
import { meta, MINDMAP_KEY, type MindmapMeta } from './NativeCanvasModel';

const LEGACY_KEY = 'enhancedCanvasMindmap';
const LEGACY_EDGE = 'enhancedCanvasMindmapRoot';

export function enhancedCanvasMeta(node: AllCanvasNodeData): MindmapMeta | undefined {
    return meta({ ...node, [MINDMAP_KEY]: node[LEGACY_KEY] });
}

/** Explicit ownership transfer. Work on a copy; malformed/mixed graphs never partially migrate. */
export function migrateEnhancedCanvasMap(source: CanvasData, selectedId: string): CanvasData {
    const selected = source.nodes.find(node => node.id === selectedId);
    const state = selected && enhancedCanvasMeta(selected);
    if (!state) throw new Error('INVALID_ENHANCED_MAP');
    const rootId = state.rootId;
    const nodes = source.nodes.filter(node => (node[LEGACY_KEY] as Partial<MindmapMeta> | undefined)?.rootId === rootId);
    const members = new Map(nodes.map(node => [node.id, node]));
    const root = members.get(rootId);
    if (!root || enhancedCanvasMeta(root)?.depth !== 0) throw new Error('INVALID_ENHANCED_MAP');
    for (const node of nodes) {
        const own = enhancedCanvasMeta(node);
        if (!own || node[MINDMAP_KEY] !== undefined) throw new Error('INVALID_ENHANCED_MAP');
        if (own.depth > 0) {
            const parent = members.get(own.parentId!);
            const parentState = parent && enhancedCanvasMeta(parent);
            if (!parentState || parentState.depth !== own.depth - 1) throw new Error('INVALID_ENHANCED_MAP');
        }
    }
    for (const edge of source.edges) if (edge[LEGACY_EDGE] === rootId &&
        (!members.has(edge.fromNode) || !members.has(edge.toNode) || edge.canvasMindMapRoot !== undefined))
        throw new Error('INVALID_ENHANCED_MAP');
    const result = JSON.parse(JSON.stringify(source)) as CanvasData;
    for (const node of result.nodes) if (members.has(node.id)) {
        const legacy = node[LEGACY_KEY] as MindmapMeta;
        node[MINDMAP_KEY] = { ...legacy, layout: legacy.layout ?? 'radial' };
        delete node[LEGACY_KEY];
    }
    for (const edge of result.edges) if (edge[LEGACY_EDGE] === rootId) {
        edge.canvasMindMapRoot = rootId; delete edge[LEGACY_EDGE];
    }
    return result;
}
