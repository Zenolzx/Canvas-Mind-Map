import type { MindMapModel, MindMapNode } from '../core/MindMapModel';

export interface Point { x: number; y: number }
export interface OrganicNode extends Point {
    id: string; title: string; width: number; height: number; depth: number;
    rootBranchId: string; direction: number; fontSize: number; fontWeight: number;
    color: string; lines: string[]; children: number; collapsed: boolean;
}
export interface OrganicBranch {
    parentId: string; childId: string; start: Point; control1: Point; control2: Point; end: Point;
    width: number; color: string;
}
export interface OrganicLayoutResult {
    nodes: OrganicNode[]; branches: OrganicBranch[];
    bounds: { x: number; y: number; width: number; height: number };
}
export interface OrganicLayoutOptions {
    collapsed: ReadonlySet<string>;
    measureText: (text: string, fontSize: number, fontWeight: number) => number;
    maxTextWidth?: number;
}
const PALETTE = ['#218b89', '#d48127', '#a65c80', '#65864a', '#647ec3', '#bc6455', '#8c6bb1', '#548c9d'];
const GAP = 24;

interface Subtree { nodes: OrganicNode[]; minY: number; maxY: number }

/** Pure geometry: weighted angular proposals, followed by whole-subtree collision packing. */
export class OrganicLayoutEngine {
    layout(model: MindMapModel, options: OrganicLayoutOptions): OrganicLayoutResult {
        const lookup = new Map(model.nodes.map(n => [n.id, n]));
        const root = lookup.get(model.rootId)!;
        const weights = new Map<string, number>();
        const weigh = (id: string): number => {
            const value = Math.max(1, lookup.get(id)!.children.reduce((sum, child) => sum + weigh(child), 0));
            weights.set(id, value); return value;
        };
        weigh(root.id);
        const make = (source: MindMapNode, branch: string, color: string, direction: number, sign: number): OrganicNode => {
            const fontSize = [30, 21, 17, 15, 14, 13, 12][Math.min(source.depth, 6)];
            const fontWeight = source.depth < 2 ? 650 : source.depth < 4 ? 500 : 400;
            const maximum = options.maxTextWidth ?? (source.depth === 0 ? 300 : 250);
            const lines: string[] = []; let line = '';
            // Latin words stay intact unless a word alone exceeds the available width.
            for (const token of (source.title || 'Untitled').match(/[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*|\s+|[^A-Za-z0-9\s]/gu) ?? []) {
                if (line && options.measureText(line + token, fontSize, fontWeight) > maximum) {
                    lines.push(line.trimEnd()); line = '';
                }
                if (!line && !token.trim()) continue;
                for (const character of Array.from(token)) {
                    if (line && options.measureText(line + character, fontSize, fontWeight) > maximum) {
                        lines.push(line); line = '';
                    }
                    line += character;
                }
            }
            lines.push(line.trimEnd());
            const width = Math.max(32, ...lines.map(text => options.measureText(text, fontSize, fontWeight))) + 24;
            const height = lines.length * fontSize * 1.4 + (source.depth === 0 ? 28 : 12);
            return { id: source.id, title: source.title, x: sign > 0 ? 0 : -width, y: -height / 2,
                width, height, depth: source.depth, rootBranchId: branch, color, direction, fontSize, fontWeight,
                lines, children: source.children.length, collapsed: options.collapsed.has(source.id) };
        };
        const translate = (tree: Subtree, x: number, y: number): void => {
            for (const node of tree.nodes) { node.x += x; node.y += y; }
            tree.minY += y; tree.maxY += y;
        };
        const angles = (ids: string[], angle: number, span: number, sign: number) => {
            const axis = sign > 0 ? 0 : Math.PI;
            span = Math.min(span, 2.1);
            // Move the entire sector inside the forward hemisphere; never clamp siblings onto one ray.
            let cursor = Math.max(axis - 1.18, Math.min(axis + 1.18 - span, angle - span / 2));
            const total = ids.reduce((sum, id) => sum + weights.get(id)!, 0);
            return ids.map(id => {
                const share = span * weights.get(id)! / total;
                const direction = cursor + share / 2; cursor += share;
                return { id, direction, span: share };
            });
        };
        const pack = (children: { tree: Subtree; angle: number }[], parent: OrganicNode, sign: number): OrganicNode[] => {
            let cursor = -Infinity;
            const base = 145 * Math.pow(0.74, parent.depth);
            const exit = parent.x + (sign > 0 ? parent.width : 0);
            for (const child of children) {
                const relative = child.angle - (sign > 0 ? 0 : Math.PI);
                const reach = base * (0.82 + 0.18 * Math.cos(relative));
                const proposed = Math.sin(child.angle) * base;
                const minimum = sign > 0 ? child.tree.minY : -child.tree.maxY;
                const position = Math.max(sign * proposed, cursor - minimum);
                translate(child.tree, exit + sign * reach, sign * position);
                // Separation follows the angular divergence as well as subtree size.
                // Equal-height labels therefore need not fall into equally spaced rows.
                const angularGap = base * 0.16 * Math.abs(Math.sin(child.angle - parent.direction));
                cursor = (sign > 0 ? child.tree.maxY : -child.tree.minY) + GAP + angularGap;
            }
            if (!children.length) return [];
            const min = Math.min(...children.map(c => c.tree.minY)), max = Math.max(...children.map(c => c.tree.maxY));
            // A branch continues along its parent tangent; sibling subtrees keep their individual extents.
            const preferredCenter = parent.depth === 0 ? 0 : Math.sin(parent.direction) * base;
            const shift = preferredCenter - (min + max) / 2;
            for (const child of children) translate(child.tree, 0, shift);
            return children.flatMap(child => child.tree.nodes);
        };
        const grow = (id: string, branch: string, color: string, direction: number, span: number, sign: number): Subtree => {
            const source = lookup.get(id)!, node = make(source, branch, color, direction, sign);
            const children = node.collapsed ? [] : angles(source.children, direction, Math.min(span, 0.95), sign)
                .map(child => ({ tree: grow(child.id, branch, color, child.direction, child.span, sign), angle: child.direction }));
            const nodes = [node, ...pack(children, node, sign)];
            return { nodes, minY: Math.min(...nodes.map(n => n.y)),
                maxY: Math.max(...nodes.map(n => n.y + n.height + (n.children ? 20 : 0))) };
        };
        // Complete-tree weights keep side and color stable through collapse and expansion.
        const sides = new Map<string, number>(), totals = [0, 0], groups: string[][] = [[], []];
        for (const id of [...root.children].sort((a, b) => weights.get(b)! - weights.get(a)!)) {
            const side = totals[0] <= totals[1] ? 0 : 1;
            sides.set(id, side); totals[side] += weights.get(id)!;
        }
        root.children.forEach(id => groups[sides.get(id)!].push(id));
        const center = make(root, root.id, '#45423f', 0, 1); center.x = -center.width / 2;
        const nodes = [center];
        if (!center.collapsed) groups.forEach((ids, side) => {
            const sign = side === 0 ? 1 : -1;
            const children = angles(ids, side === 0 ? 0 : Math.PI, ids.length > 1 ? 2.1 : 0.8, sign).map(child => ({
                tree: grow(child.id, child.id, PALETTE[root.children.indexOf(child.id) % PALETTE.length], child.direction, child.span, sign),
                angle: child.direction,
            }));
            nodes.push(...pack(children, center, sign));
        });
        const placed = new Map(nodes.map(n => [n.id, n]));
        const branches: OrganicBranch[] = [];
        for (const child of nodes) {
            const parentId = lookup.get(child.id)!.parentId;
            if (!parentId) continue;
            const parent = placed.get(parentId)!;
            const sign = Math.cos(child.direction) > 0 ? 1 : -1;
            const start = { x: parent.x + (sign > 0 ? parent.width : 0), y: parent.y + parent.height / 2 };
            const end = { x: child.x + (sign > 0 ? 0 : child.width), y: child.y + child.height / 2 };
            const reach = Math.abs(end.x - start.x);
            const tangent = parent.depth === 0 ? child.direction : parent.direction;
            branches.push({ parentId, childId: child.id, start, end,
                control1: { x: start.x + sign * reach * 0.46, y: start.y + Math.sin(tangent) * reach * 0.32 },
                control2: { x: end.x - sign * reach * 0.36, y: end.y },
                width: Math.max(1.15, 4.2 * Math.pow(0.72, child.depth - 1)), color: child.color });
        }
        const x = Math.min(...nodes.map(n => n.x)) - 48, y = Math.min(...nodes.map(n => n.y)) - 48;
        return { nodes, branches, bounds: { x, y, width: Math.max(...nodes.map(n => n.x + n.width)) - x + 48,
            height: Math.max(...nodes.map(n => n.y + n.height + 20)) - y + 48 } };
    }
}


