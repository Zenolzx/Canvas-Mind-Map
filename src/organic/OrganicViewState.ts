import type { MindMapModel } from '../core/MindMapModel';
import type { OrganicIdentity } from './OrganicNodeIdentity';
import type { WritingViewSnapshot } from '../writing/WritingViewSnapshot';

export type OrganicLayoutStyle = 'organic-radial' | 'organic-horizontal' | 'compact-organic';
export interface SavedOrganicState {
    fingerprint: string;
    identities?: OrganicIdentity[];
    collapsed: string[];
    viewport: { zoom: number; center: { x: number; y: number } };
    focusNode: string | null;
    reading: { rootNode: string | null; currentNode: string | null };
    selectedNode: string | null;
    layout: OrganicLayoutStyle;
    branchStyles?: Record<string, { color: string; side: number }>;
    writing?: { enabled: boolean; splitRatio: number; editorVisible: boolean; snapshot: WritingViewSnapshot };
}

/** Runtime document IDs are accepted only with an identical source fingerprint in phase 1. */
export class OrganicViewState {
    collapsed = new Set<string>();
    focusNode: string | null = null;
    reading = { rootNode: null as string | null, currentNode: null as string | null };
    selectedNode: string | null = null;
    layout: OrganicLayoutStyle = 'organic-radial';
    branchStyles: Record<string, { color: string; side: number }> = Object.create(null);

    reset(model: MindMapModel, layout: OrganicLayoutStyle): void {
        this.collapsed = new Set(model.nodes.filter(n => n.depth >= 2 && n.children.length).map(n => n.id));
        this.focusNode = null; this.selectedNode = null;
        this.reading = { rootNode: null, currentNode: null }; this.layout = layout;
        this.branchStyles = Object.create(null);
    }
    restore(saved: SavedOrganicState, model: MindMapModel): void {
        const ids = new Set(model.nodes.map(n => n.id));
        const valid = (id: string | null) => id && ids.has(id) ? id : null;
        this.collapsed = new Set(saved.collapsed.filter(id => ids.has(id)));
        this.focusNode = valid(saved.focusNode); this.selectedNode = valid(saved.selectedNode);
        this.reading = { rootNode: valid(saved.reading.rootNode), currentNode: valid(saved.reading.currentNode) };
        this.layout = saved.layout;
        this.branchStyles = saved.branchStyles ?? Object.create(null);
    }
}

/** Compact deterministic document fingerprint; not a node identity or a security boundary. */
export function sourceFingerprint(text: string): string {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619);
        b = Math.imul(b, 33) ^ text.charCodeAt(i);
    }
    return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
