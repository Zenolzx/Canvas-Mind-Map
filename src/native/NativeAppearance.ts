import type { CanvasData } from 'obsidian/canvas';
import { applyStyle, captureOverrides, meta, treeNodes } from './NativeCanvasModel';

const PALETTE = ['#168f91', '#cf851b', '#ad507f', '#688a40', '#587bcc', '#c75f4d', '#9265b9', '#547f91'];

/** Explicitly opt a native map into branch styling. Retain manual overrides and
 * store first-branch identity so folding and source refresh cannot recolor it. */
export function applyBranchAppearance(data: CanvasData, rootId: string): void {
    const tree = treeNodes(data, rootId), root = tree.find(n => n.id === rootId);
    if (!root) return;
    meta(root)!.appearance = 'branch';
    const lookup = new Map(tree.map(n => [n.id, n]));
    const branches = tree.filter(n => meta(n)!.parentId === rootId);
    const used = new Set(branches.map(n => meta(n)!.branchColor).filter(Boolean));
    for (const [index, branch] of branches.entries()) {
        const state = meta(branch)!;
        state.branchColor ??= PALETTE.find(color => !used.has(color)) ?? PALETTE[index % PALETTE.length];
        used.add(state.branchColor);
    }
    for (const node of tree) {
        const state = meta(node)!;
        captureOverrides(node);
        let branch = node;
        const seen = new Set<string>();
        while (meta(branch)!.parentId && meta(branch)!.parentId !== rootId && !seen.has(branch.id)) {
            seen.add(branch.id);
            const parent = lookup.get(meta(branch)!.parentId!);
            if (!parent) break;
            branch = parent;
        }
        state.appearance = 'branch';
        state.branchColor = node.id === rootId ? undefined : meta(branch)!.branchColor;
        // Applying colors must not reset an already measured automatic height.
        const height = node.height;
        applyStyle(node, { ...state.style, color: state.branchColor ?? state.style.color });
        node.height = height;
        state.applied.height = height;
    }
    for (const edge of data.edges) {
        if (edge.canvasMindMapRoot !== rootId) continue;
        const child = lookup.get(edge.toNode);
        const color = child && meta(child)?.branchColor;
        const untouched = edge.canvasMindMapAppliedColor === undefined ? !edge.color
            : edge.color === edge.canvasMindMapAppliedColor;
        if (color && untouched) {
            edge.color = color; edge.canvasMindMapAppliedColor = color;
        }
    }
}
