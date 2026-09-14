import type { AllCanvasNodeData, CanvasData, CanvasEdgeData, NodeSide } from 'obsidian/canvas';
import type { MindmapLevelStyle, MindmapLayout } from '../settings';

/** Stored on ordinary Canvas nodes; folding never removes nodes or edges. */
export interface MindmapMeta {
    version: 1;
    nodeId: string;
    rootId: string;
    parentId?: string;
    depth: number;
    key: string;
    title: string;
    expanded: boolean;
    angle: number;
    placed: boolean;
    mode: 'title' | 'body';
    layout?: MindmapLayout;
    style: MindmapLevelStyle;
    applied: { width: number; height: number; color: string };
    overrides?: { width?: boolean; height?: boolean; color?: boolean; autoHeight?: boolean };
    generatedText?: string;
    source?: { file?: string; text?: string };
    compact?: boolean;
}

export { parseHeadings } from '../core/HeadingParser';
export type { HeadingSection } from '../core/HeadingParser';

export const MINDMAP_KEY = 'canvasMindMap';

export function meta(node: AllCanvasNodeData): MindmapMeta | undefined {
    const value = node[MINDMAP_KEY] as MindmapMeta | undefined;
    if (value?.version !== 1 || typeof value.rootId !== 'string' ||
        value.nodeId !== node.id ||
        !Number.isInteger(value.depth) || value.depth < 0 || value.depth > 6 ||
        typeof value.key !== 'string' || typeof value.title !== 'string' ||
        typeof value.expanded !== 'boolean' || !Number.isFinite(value.angle) ||
        !value.style || !value.applied) return undefined;
    if (value.depth === 0 ? value.rootId !== node.id || !!value.parentId : typeof value.parentId !== 'string') return undefined;
    return value;
}

export function treeNodes(data: CanvasData, rootId: string): AllCanvasNodeData[] {
    const root = data.nodes.find(node => node.id === rootId);
    if (!root || meta(root)?.depth !== 0) return [];
    return data.nodes.filter(node => meta(node)?.rootId === rootId);
}

/** Invalid/orphaned relationships fail open, so deleting a parent cannot hide data forever. */
export function hiddenNodes(nodes: AllCanvasNodeData[]): Set<string> {
    const lookup = new Map(nodes.map(node => [node.id, node]));
    const hidden = new Set<string>();
    for (const node of nodes) {
        const own = meta(node);
        if (!own || own.depth === 0) continue;
        const root = lookup.get(own.rootId);
        if (!root || meta(root)?.depth !== 0) continue;
        let current = own, folded = false, valid = true;
        const seen = new Set([node.id]);
        while (current.parentId) {
            if (seen.has(current.parentId)) { valid = false; break; }
            seen.add(current.parentId);
            const parent = lookup.get(current.parentId);
            const parentMeta = parent && meta(parent);
            if (!parentMeta || parentMeta.rootId !== own.rootId || parentMeta.depth >= current.depth) { valid = false; break; }
            if (!parentMeta.expanded) folded = true;
            current = parentMeta;
        }
        if (valid && current.depth === 0 && folded) hidden.add(node.id);
    }
    return hidden;
}

export function descendants(nodes: AllCanvasNodeData[], id: string): AllCanvasNodeData[] {
    const children = new Map<string, AllCanvasNodeData[]>();
    for (const node of nodes) {
        const parent = meta(node)?.parentId;
        if (parent) children.set(parent, [...(children.get(parent) ?? []), node]);
    }
    const result: AllCanvasNodeData[] = [], seen = new Set([id]), queue = [...(children.get(id) ?? [])];
    for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        if (seen.has(node.id)) continue;
        seen.add(node.id); result.push(node); queue.push(...(children.get(node.id) ?? []));
    }
    return result;
}

export function overlaps(a: AllCanvasNodeData, b: AllCanvasNodeData, gap = 48): boolean {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
        a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Allocate angular sectors by subtree leaf count. Titles themselves never rotate. */
export function assignAngles(nodes: AllCanvasNodeData[], rootId: string): void {
    const children = new Map<string, AllCanvasNodeData[]>();
    for (const node of nodes) {
        const parent = meta(node)?.parentId;
        if (parent) children.set(parent, [...(children.get(parent) ?? []), node]);
    }
    const weights = new Map<string, number>();
    const weigh = (id: string): number => {
        const weight = Math.max(1, (children.get(id) ?? []).reduce((sum, child) => sum + weigh(child.id), 0));
        weights.set(id, weight); return weight;
    };
    weigh(rootId);
    const allocate = (id: string, start: number, span: number) => {
        let cursor = start;
        for (const child of children.get(id) ?? []) {
            const width = id === rootId ? span / (children.get(id)?.length ?? 1)
                : span * (weights.get(child.id) ?? 1) / (weights.get(id) ?? 1);
            meta(child)!.angle = cursor + width / 2;
            // A lone/dominant first branch can own most of the circle. Its
            // descendants still grow outward, instead of turning back through the center.
            const outwardSpan = Math.min(width, Math.PI * 0.8);
            allocate(child.id, meta(child)!.angle - outwardSpan / 2, outwardSpan);
            cursor += width;
        }
    };
    allocate(rootId, -Math.PI, Math.PI * 2);
}

/** Directional trees reflow affected sides; radial trees retain angular placement. */
export function placeNodes(data: CanvasData, rootId: string, candidates: Set<string>, anchorId?: string): void {
    const center = data.nodes.find(node => node.id === rootId);
    if (!center) return;
    const layout = meta(center)?.layout ?? 'radial';
    if (layout !== 'radial') { placeDirectionalNodes(data, rootId, candidates, layout, anchorId); return; }
    const hidden = hiddenNodes(data.nodes);
    const lookup = new Map(data.nodes.map(node => [node.id, node]));
    const tree = treeNodes(data, rootId);
    const root = lookup.get(rootId);
    if (!root) return;
    const cx = root.x + root.width / 2, cy = root.y + root.height / 2;
    const movable = new Set(tree.filter(node => node.id !== rootId && candidates.has(node.id)).map(node => node.id));
    const occupied = data.nodes.filter(node => !hidden.has(node.id) && !movable.has(node.id) && node.type !== 'group');
    const pending = tree.filter(node => movable.has(node.id) && !hidden.has(node.id))
        .sort((a, b) => meta(a)!.depth - meta(b)!.depth);
    const radii = new Map<number, number>([[0, 0]]);
    let previousSize = Math.hypot(root.width, root.height);
    for (let depth = 1; depth <= 6; depth++) {
        const level = tree.filter(node => meta(node)!.depth === depth && !hidden.has(node.id));
        const size = Math.max(0, ...level.map(node => Math.hypot(node.width, node.height)));
        radii.set(depth, (radii.get(depth - 1) ?? 0) + (previousSize + size) / 2 + 120);
        previousSize = size;
    }
    for (const node of pending) {
        const state = meta(node)!;
        const parent = lookup.get(state.parentId ?? '');
        if (!parent) continue;
        if (!state.placed || occupied.some(other => overlaps(node, other))) {
            const angle = state.angle;
            // Shared concentric rings and disjoint angular sectors keep branches
            // ordered around the center rather than weaving across neighboring trees.
            const parentRadius = Math.hypot(parent.x + parent.width / 2 - cx, parent.y + parent.height / 2 - cy);
            let distance = Math.max(radii.get(state.depth) ?? 0,
                parentRadius + (Math.hypot(parent.width, parent.height) + Math.hypot(node.width, node.height)) / 2 + 120);
            do {
                node.x = Math.round(cx + Math.cos(angle) * distance - node.width / 2);
                node.y = Math.round(cy + Math.sin(angle) * distance - node.height / 2);
                distance += Math.max(80, Math.min(node.width, node.height));
            } while (occupied.some(other => overlaps(node, other)));
        }
        state.placed = true;
        occupied.push(node);
    }
    updateEdgeSides(data, rootId);
}

/** Reflow affected sides as ordered subtree lanes; keep the interaction anchor fixed. */
function placeDirectionalNodes(data: CanvasData, rootId: string, candidates: Set<string>, layout: MindmapLayout, anchorId?: string): void {
    const hidden = hiddenNodes(data.nodes);
    const tree = treeNodes(data, rootId).filter(node => !hidden.has(node.id));
    const root = tree.find(node => node.id === rootId);
    if (!root) return;
    const vertical = layout === 'vertical' || layout === 'up' || layout === 'down';
    const dual = layout === 'horizontal' || layout === 'vertical';
    const mainSize = (node: AllCanvasNodeData) => vertical ? node.height : node.width;
    const crossSize = (node: AllCanvasNodeData) => vertical ? node.width : node.height;
    const mainCenter = (node: AllCanvasNodeData) => vertical ? node.y + node.height / 2 : node.x + node.width / 2;
    const crossCenter = (node: AllCanvasNodeData) => vertical ? node.x + node.width / 2 : node.y + node.height / 2;
    const children = new Map<string, AllCanvasNodeData[]>();
    for (const node of tree) {
        const parent = meta(node)!.parentId;
        if (parent) children.set(parent, [...(children.get(parent) ?? []), node]);
    }
    const spans = new Map<string, number>();
    const measure = (node: AllCanvasNodeData): number => {
        const kids = children.get(node.id) ?? [];
        const span = Math.max(crossSize(node), kids.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, kids.length - 1) * 80);
        spans.set(node.id, span);
        return span;
    };
    measure(root);
    const sides = new Map<string, number>(), groups: AllCanvasNodeData[][] = [[], []];
    const totals = [0, 0];
    const branches = children.get(rootId) ?? [];
    const branchSides = new Map<string, number>();
    if (dual) {
        // Preserve established sides during expansion. On generation/full relayout,
        // allocate the largest subtrees first, then retain document order per side.
        for (const branch of branches) if (meta(branch)!.placed && (!candidates.has(branch.id) || !!anchorId)) {
            const side = mainCenter(branch) >= mainCenter(root) ? 1 : -1;
            branchSides.set(branch.id, side);
            totals[side === 1 ? 0 : 1] += spans.get(branch.id)! + 80;
        }
        for (const branch of [...branches].sort((a, b) => spans.get(b.id)! - spans.get(a.id)!)) {
            if (branchSides.has(branch.id)) continue;
            const side = totals[0] <= totals[1] ? 1 : -1;
            branchSides.set(branch.id, side);
            totals[side === 1 ? 0 : 1] += spans.get(branch.id)! + 80;
        }
    }
    for (const branch of branches) {
        let side = layout === 'left' || layout === 'up' ? -1 : 1;
        if (dual) side = branchSides.get(branch.id)!;
        const index = side === 1 ? 0 : 1;
        groups[index].push(branch);
        for (const member of [branch, ...descendants(tree, branch.id)]) sides.set(member.id, side);
    }
    const sizes = new Map<number, number>([[0, mainSize(root)]]);
    for (const node of tree) sizes.set(meta(node)!.depth, Math.max(sizes.get(meta(node)!.depth) ?? 0, mainSize(node)));
    const distances = new Map<number, number>([[0, 0]]);
    for (let depth = 1; depth <= 6; depth++) distances.set(depth, distances.get(depth - 1)! + (sizes.get(depth - 1) ?? 0) / 2 + (sizes.get(depth) ?? 0) / 2 + 120);
    const targets = new Map<string, { main: number; cross: number }>();
    targets.set(rootId, { main: mainCenter(root), cross: crossCenter(root) });
    const arrange = (siblings: AllCanvasNodeData[], center: number): void => {
        const span = siblings.reduce((sum, node) => sum + spans.get(node.id)!, 0) + Math.max(0, siblings.length - 1) * 80;
        let cursor = center - span / 2;
        for (const node of siblings) {
            const cross = cursor + spans.get(node.id)! / 2;
            targets.set(node.id, { main: mainCenter(root) + sides.get(node.id)! * distances.get(meta(node)!.depth)!, cross });
            arrange(children.get(node.id) ?? [], cross);
            cursor += spans.get(node.id)! + 80;
        }
    };
    for (const group of groups) arrange(group, crossCenter(root));
    const affected = new Set([...candidates, ...(anchorId ? [anchorId] : [])].map(id => sides.get(id)));
    if (anchorId === rootId) { affected.add(1); affected.add(-1); }
    const movable = new Set(tree.filter(node => node.id !== rootId && affected.has(sides.get(node.id))).map(node => node.id));
    const anchor = tree.find(node => node.id === anchorId);
    const anchorTarget = anchor && targets.get(anchor.id);
    const crossShift = anchor && anchorTarget ? crossCenter(anchor) - anchorTarget.cross : 0;
    const mainShift = anchor && anchorTarget ? mainCenter(anchor) - anchorTarget.main : 0;
    const occupied = data.nodes.filter(node => !hidden.has(node.id) && !movable.has(node.id) && node.type !== 'group');
    const lookup = new Map(tree.map(node => [node.id, node]));
    for (const node of tree.filter(node => movable.has(node.id)).sort((a, b) => meta(a)!.depth - meta(b)!.depth)) {
        const state = meta(node)!, target = targets.get(node.id), parent = lookup.get(state.parentId!);
        if (!target || !parent) continue;
        // Manual positioning can use fractional canvas coordinates. Preserve the
        // anchor exactly, rather than rounding it through the layout calculation.
        if (node.id === anchorId) { state.placed = true; occupied.push(node); continue; }
        {
            const side = sides.get(node.id)!;
            const anchoredSide = anchor && sides.get(anchor.id) === side;
            let main = target.main + (anchoredSide ? mainShift : 0);
            // A card displaced by an unrelated canvas obstacle must still have
            // children farther outward, never a backwards connector.
            if (node.id !== anchorId) main = side * Math.max(side * main,
                side * mainCenter(parent) + (mainSize(parent) + mainSize(node)) / 2 + 120);
            // All members share a lane offset: never move individual children back
            // toward an old parent position, which crossed adjacent subtree edges.
            const cross = target.cross + (anchoredSide ? crossShift : 0);
            do {
                const x = vertical ? cross : main, y = vertical ? main : cross;
                node.x = Math.round(x - node.width / 2); node.y = Math.round(y - node.height / 2);
                main += side * Math.max(80, mainSize(node) + 48);
            } while (node.id !== anchorId && occupied.some(other => overlaps(node, other)));
        }
        state.placed = true; occupied.push(node);
    }
    updateEdgeSides(data, rootId);
}

export function updateEdgeSides(data: CanvasData, rootId: string): void {
    const nodes = new Map(data.nodes.map(node => [node.id, node]));
    for (const edge of data.edges) {
        if (edge.canvasMindMapRoot !== rootId) continue;
        const from = nodes.get(edge.fromNode), to = nodes.get(edge.toNode);
        if (!from || !to) continue;
        const dx = to.x + to.width / 2 - from.x - from.width / 2;
        const dy = to.y + to.height / 2 - from.y - from.height / 2;
        const root = nodes.get(rootId);
        const layout = root && meta(root)?.layout;
        const horizontal = layout === 'horizontal' || layout === 'left' || layout === 'right';
        const vertical = layout === 'vertical' || layout === 'up' || layout === 'down';
        const side: NodeSide = horizontal ? (dx >= 0 ? 'right' : 'left') : vertical ? (dy >= 0 ? 'bottom' : 'top') : Math.abs(dx) > Math.abs(dy)
            ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
        edge.fromSide = side;
        edge.toSide = ({ right: 'left', left: 'right', top: 'bottom', bottom: 'top' } as Record<NodeSide, NodeSide>)[side];
    }
}

export interface FocusLayoutOptions {
    focusId: string;
    mode: 'hide' | 'dim';
}

/** Build a temporary, local projection for branch reading. The focus node stays
 * fixed; only currently unfolded descendants move. Callers own restoration. */
export function layoutFocusedSubtree(data: CanvasData, options: FocusLayoutOptions): Set<string> {
    const focus = data.nodes.find(node => node.id === options.focusId), focusState = focus && meta(focus);
    if (!focus || !focusState) return new Set();
    const tree = treeNodes(data, focusState.rootId), folded = hiddenNodes(data.nodes);
    const subtreeIds = new Set([focus.id, ...descendants(tree, focus.id).map(node => node.id)]);
    const local = tree.filter(node => subtreeIds.has(node.id) && !folded.has(node.id));
    const movable = new Set(local.filter(node => node.id !== focus.id).map(node => node.id));
    if (!movable.size) return movable;

    const lookup = new Map(local.map(node => [node.id, node]));
    const allLookup = new Map(data.nodes.map(node => [node.id, node]));
    const children = new Map<string, AllCanvasNodeData[]>();
    for (const node of local) {
        const parent = meta(node)?.parentId;
        if (parent && lookup.has(parent)) children.set(parent, [...(children.get(parent) ?? []), node]);
    }
    const center = (node: AllCanvasNodeData) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
    const original = new Map(data.nodes.map(node => [node.id, center(node)]));
    const anchor = center(focus), root = tree.find(node => node.id === focusState.rootId);
    const layout = root ? meta(root)?.layout ?? 'radial' : 'radial';
    const localDepth = new Map<string, number>([[focus.id, 0]]);
    const visit = (id: string) => { for (const child of children.get(id) ?? []) { localDepth.set(child.id, localDepth.get(id)! + 1); visit(child.id); } };
    visit(focus.id);
    const targets = new Map<string, { x: number; y: number }>([[focus.id, anchor]]);

    const radial = layout === 'radial';
    if (radial) {
        const maxSize = new Map<number, number>();
        for (const node of local) {
            const depth = localDepth.get(node.id)!;
            maxSize.set(depth, Math.max(maxSize.get(depth) ?? 0, Math.hypot(node.width, node.height)));
        }
        const radii = new Map<number, number>([[0, 0]]);
        for (let depth = 1; depth <= Math.max(...localDepth.values()); depth++) {
            radii.set(depth, radii.get(depth - 1)! + (maxSize.get(depth - 1) ?? 0) / 2 + (maxSize.get(depth) ?? 0) / 2 + 120);
        }
        const weights = new Map<string, number>();
        const weigh = (id: string): number => {
            const result = Math.max(1, (children.get(id) ?? []).reduce((sum, child) => sum + weigh(child.id), 0));
            weights.set(id, result); return result;
        };
        weigh(focus.id);
        let direction = -Math.PI;
        let span = Math.PI * 2;
        if (focus.id !== focusState.rootId) {
            const parent = allLookup.get(focusState.parentId ?? ''), from = parent && original.get(parent.id), to = original.get(focus.id)!;
            direction = from ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
            span = Math.PI * 0.9;
        }
        const allocate = (id: string, start: number, width: number): void => {
            let cursor = start;
            const total = (children.get(id) ?? []).reduce((sum, child) => sum + (weights.get(child.id) ?? 1), 0) || 1;
            for (const child of children.get(id) ?? []) {
                const childWidth = width * (weights.get(child.id) ?? 1) / total;
                const angle = cursor + childWidth / 2, radius = radii.get(localDepth.get(child.id)!)!;
                targets.set(child.id, { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius });
                allocate(child.id, angle - Math.min(childWidth, Math.PI * 0.72) / 2, Math.min(childWidth, Math.PI * 0.72));
                cursor += childWidth;
            }
        };
        allocate(focus.id, direction - span / 2, span);
    } else {
        const vertical = layout === 'vertical' || layout === 'up' || layout === 'down';
        const dual = focus.id === focusState.rootId && (layout === 'horizontal' || layout === 'vertical');
        const configuredSign = layout === 'left' || layout === 'up' ? -1 : 1;
        const parent = allLookup.get(focusState.parentId ?? '');
        const focusCenter = original.get(focus.id)!;
        const parentCenter = parent && original.get(parent.id);
        const inheritedSign = parentCenter ? Math.sign((vertical ? focusCenter.y - parentCenter.y : focusCenter.x - parentCenter.x)) || configuredSign : configuredSign;
        const mainSize = (node: AllCanvasNodeData) => vertical ? node.height : node.width;
        const crossSize = (node: AllCanvasNodeData) => vertical ? node.width : node.height;
        const spans = new Map<string, number>();
        const measure = (node: AllCanvasNodeData): number => {
            const kids = children.get(node.id) ?? [];
            const value = Math.max(crossSize(node), kids.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, kids.length - 1) * 80);
            spans.set(node.id, value); return value;
        };
        measure(focus);
        const levelSize = new Map<number, number>([[0, mainSize(focus)]]);
        for (const node of local) levelSize.set(localDepth.get(node.id)!, Math.max(levelSize.get(localDepth.get(node.id)!) ?? 0, mainSize(node)));
        const distance = new Map<number, number>([[0, 0]]);
        for (let depth = 1; depth <= Math.max(...localDepth.values()); depth++) {
            distance.set(depth, distance.get(depth - 1)! + (levelSize.get(depth - 1) ?? 0) / 2 + (levelSize.get(depth) ?? 0) / 2 + 120);
        }
        const placeBranch = (siblings: AllCanvasNodeData[], crossCenter: number, sign: number): void => {
            const total = siblings.reduce((sum, node) => sum + spans.get(node.id)!, 0) + Math.max(0, siblings.length - 1) * 80;
            let cursor = crossCenter - total / 2;
            for (const node of siblings) {
                const cross = cursor + spans.get(node.id)! / 2;
                const main = (vertical ? anchor.y : anchor.x) + sign * distance.get(localDepth.get(node.id)!)!;
                targets.set(node.id, vertical ? { x: cross, y: main } : { x: main, y: cross });
                placeBranch(children.get(node.id) ?? [], cross, sign);
                cursor += spans.get(node.id)! + 80;
            }
        };
        const branches = children.get(focus.id) ?? [];
        if (dual) {
            const groups: [AllCanvasNodeData[], AllCanvasNodeData[]] = [[], []];
            let totals = [0, 0];
            for (const branch of [...branches].sort((a, b) => spans.get(b.id)! - spans.get(a.id)!)) {
                const index = totals[0] <= totals[1] ? 0 : 1;
                groups[index].push(branch); totals[index] += spans.get(branch.id)!;
            }
            placeBranch(groups[0], vertical ? anchor.x : anchor.y, 1);
            placeBranch(groups[1], vertical ? anchor.x : anchor.y, -1);
        } else placeBranch(branches, vertical ? anchor.x : anchor.y, focus.id === focusState.rootId ? configuredSign : inheritedSign);
    }

    const occupied = options.mode === 'dim'
        ? data.nodes.filter(node => !subtreeIds.has(node.id) && !folded.has(node.id) && node.type !== 'group') : [];
    const placed: AllCanvasNodeData[] = [focus];
    for (const node of local.filter(node => node.id !== focus.id).sort((a, b) => localDepth.get(a.id)! - localDepth.get(b.id)!)) {
        const target = targets.get(node.id);
        if (!target) continue;
        let dx = target.x - anchor.x, dy = target.y - anchor.y;
        const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
        node.x = Math.round(target.x - node.width / 2); node.y = Math.round(target.y - node.height / 2);
        let attempts = 0;
        while (attempts++ < 200 && [...occupied, ...placed].some(other => overlaps(node, other))) {
            node.x = Math.round(node.x + dx * 80); node.y = Math.round(node.y + dy * 80);
        }
        placed.push(node);
    }
    updateEdgeSides(data, focusState.rootId);
    return movable;
}

export function captureOverrides(node: AllCanvasNodeData): void {
    const state = meta(node);
    if (!state) return;
    state.overrides = { ...state.overrides,
        width: state.overrides?.width || node.width !== state.applied.width,
        height: state.overrides?.height || node.height !== state.applied.height,
        color: state.overrides?.color || (node.color ?? '') !== state.applied.color };
    if (state.overrides.height) state.style = { ...state.style, autoHeight: false };
}

export function applyStyle(node: AllCanvasNodeData, style: MindmapLevelStyle): void {
    const state = meta(node)!;
    captureOverrides(node);
    const keepHeight = state.overrides?.height || state.overrides?.autoHeight;
    state.style = { ...style, autoHeight: keepHeight ? state.style.autoHeight : style.autoHeight,
        height: keepHeight ? state.style.height : style.height };
    if (!state.overrides?.width) node.width = style.width;
    if (!state.overrides?.height) node.height = state.style.height;
    if (!state.overrides?.color) node.color = style.color;
    state.applied = { width: node.width, height: node.height, color: node.color ?? '' };
}

export function treeEdge(id: string, rootId: string, parent: string, child: string): CanvasEdgeData {
    return { id, fromNode: parent, toNode: child, toEnd: 'none', canvasMindMapRoot: rootId };
}


