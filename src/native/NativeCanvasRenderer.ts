import type { AllCanvasNodeData } from 'obsidian/canvas';
import type { MindMapModel } from '../core/MindMapModel';
import { MINDMAP_KEY, MindmapMeta } from '../MindmapModel';
import type { MindmapLevelStyle } from '../settings';

/** Converts shared document structure to native cards. Canvas owns editing and history. */
export class NativeCanvasRenderer {
    render(model: MindMapModel, options: {
        rootId: string; x: number; y: number; mode: 'title' | 'body';
        id: () => string; style: (depth: number) => MindmapLevelStyle;
        payload: (title: string, content: string) => { data: { type: 'text'; text: string } | { type: 'file'; file: string; subpath: string }; generatedText?: string };
    }): AllCanvasNodeData[] {
        const headings = model.nodes.filter(node => node.id !== model.rootId);
        const ids = new Map(headings.map(node => [node.id, options.id()]));
        return headings.map(node => {
            const id = ids.get(node.id)!, style = options.style(node.depth);
            const payload = options.payload(node.title, node.content);
            const state: MindmapMeta = {
                version: 1, nodeId: id, rootId: options.rootId, parentId: ids.get(node.parentId!) ?? options.rootId,
                depth: node.depth, key: node.key, title: node.title, expanded: node.depth < 2,
                angle: 0, placed: false, mode: options.mode, style,
                applied: { width: style.width, height: style.height, color: style.color },
                generatedText: payload.generatedText,
            };
            return { ...payload.data, id, x: options.x, y: options.y, width: style.width, height: style.height,
                color: style.color, [MINDMAP_KEY]: state } as AllCanvasNodeData;
        });
    }
}
