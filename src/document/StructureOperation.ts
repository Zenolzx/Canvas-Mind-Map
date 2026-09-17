export type StructureOperation =
    | { type: 'rename'; nodeId: string; title: string }
    | { type: 'insertSibling'; nodeId: string; title: string; position?: 'before' | 'after' }
    | { type: 'insertChild'; nodeId: string; title: string }
    | { type: 'delete'; nodeId: string; strategy: 'subtree' | 'promoteChildren' }
    | { type: 'move'; nodeId: string; parentId: string; index: number }
    | { type: 'moveBefore' | 'moveAfter'; nodeId: string; targetId: string }
    | { type: 'promote' | 'demote'; nodeId: string }
    | { type: 'updateBody'; nodeId: string; markdown: string; cursorOffset?: number };

export interface StructureSelection { readonly nodeId: string | null; readonly bodyOffset?: number }
export interface StructureViewSnapshot {
    readonly selectedNode: string | null;
    readonly collapsed: readonly string[];
    readonly zoom: number;
    readonly center: { readonly x: number; readonly y: number };
    readonly focusNode: string | null;
}
