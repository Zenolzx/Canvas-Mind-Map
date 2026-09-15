import type { MindmapLayout } from '../settings';

export interface NativeLayoutNode {
    id: string; parentId?: string; depth: number;
    x: number; y: number; width: number; height: number;
    visible: boolean; placed: boolean; angle: number;
}
export interface NativeLayoutOptions {
    rootId: string; layout: MindmapLayout; candidates: Set<string>; anchorId?: string;
    obstacles: { x: number; y: number; width: number; height: number }[];
}
type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Placement = Box & { id: string };
const gap = (depth: number) => 32 + 22 * Math.pow(0.72, depth);
const reach = (depth: number) => 52 + 100 * Math.pow(0.72, Math.max(0, depth - 1));

/** Pure geometry using measured native card bounds. No Canvas or DOM operations.
 * Whole subtrees move past obstacles together, preserving their internal structure. */
export function layoutNative(nodes: NativeLayoutNode[], options: NativeLayoutOptions): Map<string, Point> {
    const lookup = new Map(nodes.map(n => [n.id, n]));
    const root = lookup.get(options.rootId);
    const result = new Map<string, Point>();
    if (!root) return result;
    const children = new Map<string, NativeLayoutNode[]>();
    for (const n of nodes) if (n.parentId && lookup.has(n.parentId)) {
        children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
    }
    const center = (n: Box): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
    const visibleKids = (id: string) => (children.get(id) ?? []).filter(n => n.visible);
    const vertical = ['vertical', 'up', 'down'].includes(options.layout);
    const weights = new Map<string, number>();
    const fullWeight = (n: NativeLayoutNode): number => {
        if (!weights.has(n.id)) weights.set(n.id, Math.max((vertical ? n.width : n.height) + 40,
            (children.get(n.id) ?? []).reduce((s, child) => s + fullWeight(child), 0)));
        return weights.get(n.id)!;
    };
    const branches = children.get(root.id) ?? [];
    const branchOf = new Map<string, string>();
    const mark = (n: NativeLayoutNode, id: string) => {
        branchOf.set(n.id, id);
        for (const child of children.get(n.id) ?? []) mark(child, id);
    };
    for (const b of branches) mark(b, b.id);
    const dual = ['horizontal', 'vertical'].includes(options.layout);
    const directions = new Map<string, number>();
    const totals = [0, 0];
    for (const b of [...branches].sort((a, b) => fullWeight(b) - fullWeight(a))) {
        let side = ['left', 'up'].includes(options.layout) ? -1 : 1;
        if (dual) {
            side = b.placed ? ((vertical ? center(b).y - center(root).y : center(b).x - center(root).x) >= 0 ? 1 : -1)
                : totals[0] <= totals[1] ? 1 : -1;
            totals[side === 1 ? 0 : 1] += fullWeight(b);
        }
        directions.set(b.id, options.layout === 'radial' ? (b.placed
            ? Math.atan2(center(b).y - center(root).y, center(b).x - center(root).x) : b.angle)
            : vertical ? side * Math.PI / 2 : side === 1 ? 0 : Math.PI);
    }
    const affected = new Set([...options.candidates].map(id => branchOf.get(id)).filter((id): id is string => !!id));
    if (options.anchorId && options.anchorId !== root.id) {
        // An interaction may only move its own branch, including deferred height fitting.
        affected.clear();
        const branch = branchOf.get(options.anchorId);
        if (branch) affected.add(branch);
    }
    const active = nodes.filter(n => n.visible);
    const localAnchor = options.anchorId && options.anchorId !== root.id ? lookup.get(options.anchorId) : undefined;
    // Keep the ancestor path fixed for nested interactions. Repacking below the
    // clicked heading is sufficient and avoids moving a parent through its anchor.
    const movable = new Set<string>();
    const collect = (n: NativeLayoutNode) => {
        if (!n.visible) return;
        movable.add(n.id); for (const child of visibleKids(n.id)) collect(child);
    };
    if (localAnchor) for (const child of visibleKids(localAnchor.id)) collect(child);
    else for (const b of branches) if (affected.has(b.id)) collect(b);
    const occupied: Box[] = [...options.obstacles, ...active.filter(n => !movable.has(n.id))];

    const build = (n: NativeLayoutNode, angle: number): Placement[] => {
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const orientation = Math.abs(ux) >= Math.abs(uy) ? (ux >= 0 ? 1 : -1) : (uy >= 0 ? -1 : 1);
        const vx = -uy * orientation, vy = ux * orientation;
        const main = (b: Box) => Math.abs(ux) * b.width + Math.abs(uy) * b.height;
        const cross = (b: Box) => Math.abs(uy) * b.width + Math.abs(ux) * b.height;
        const packs = visibleKids(n.id).map(child => {
            const items = build(child, angle);
            const extent = Math.max(...items.map(p => vx * (p.x + p.width / 2) + vy * (p.y + p.height / 2) + cross(p) / 2))
                - Math.min(...items.map(p => vx * (p.x + p.width / 2) + vy * (p.y + p.height / 2) - cross(p) / 2));
            return { child, items, extent };
        });
        const spacing = gap(n.depth) + 5 * Math.log2(1 + packs.length);
        const total = packs.reduce((s, p) => s + p.extent, 0) + Math.max(0, packs.length - 1) * spacing;
        let cursor = -total / 2;
        const items: Placement[] = [{ id: n.id, x: -n.width / 2, y: -n.height / 2, width: n.width, height: n.height }];
        for (const pack of packs) {
            const crossOffset = cursor + pack.extent / 2;
            const distance = (main(n) + main(pack.child)) / 2 + reach(pack.child.depth)
                + Math.abs(crossOffset) * 0.10;
            const dx = ux * distance + vx * crossOffset, dy = uy * distance + vy * crossOffset;
            for (const p of pack.items) items.push({ ...p, x: p.x + dx, y: p.y + dy });
            cursor += pack.extent + spacing;
        }
        return items;
    };
    const place = (pack: Placement[], angle: number, origin: Point) => {
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const translated = pack.map(p => ({ ...p, x: p.x + origin.x, y: p.y + origin.y }));
        // Exact forbidden translation intervals for AABB sweeps: finite work even
        // for large unrelated cards, with no retry cap or random displacement.
        const intervals: [number, number][] = [];
        for (const p of translated) for (const box of occupied) {
            let lo = -Infinity, hi = Infinity;
            for (const [start, size, otherStart, otherSize, speed] of [
                [p.x, p.width, box.x, box.width, ux], [p.y, p.height, box.y, box.height, uy],
            ]) {
                const a = otherStart - 28 - start - size, b = otherStart + otherSize + 28 - start;
                if (Math.abs(speed) < 1e-8) { if (a >= 0 || b <= 0) { hi = -Infinity; break; } }
                else { lo = Math.max(lo, Math.min(a / speed, b / speed)); hi = Math.min(hi, Math.max(a / speed, b / speed)); }
            }
            if (lo < hi && hi > 0) intervals.push([lo, hi]);
        }
        let shift = 0;
        for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
            if (lo > shift) break;
            if (hi >= shift) shift = hi + 1;
        }
        for (const p of translated) {
            const box = { ...p, x: p.x + ux * shift, y: p.y + uy * shift };
            result.set(p.id, { x: box.x, y: box.y }); occupied.push(box);
        }
    };
    if (localAnchor) {
        const angle = directions.get(branchOf.get(localAnchor.id)!) ?? 0;
        const pack = build(localAnchor, angle);
        // Shift each child subtree as a unit; the clicked card remains untouched.
        for (const child of visibleKids(localAnchor.id)) {
            const ids = new Set<string>();
            const visit = (n: NativeLayoutNode) => { ids.add(n.id); for (const c of visibleKids(n.id)) visit(c); };
            visit(child);
            place(pack.filter(p => ids.has(p.id)), angle, center(localAnchor));
        }
    } else {
        const groups = new Map<number, NativeLayoutNode[]>();
        for (const b of branches.filter(n => n.visible)) {
            const angle = directions.get(b.id)!;
            groups.set(angle, [...(groups.get(angle) ?? []), b]);
        }
        for (const [angle, group] of groups) {
            // Build a virtual root with this direction's branches only.
            const previous = children.get(root.id);
            children.set(root.id, group);
            const pack = build(root, angle);
            children.set(root.id, previous!);
            for (const b of group) if (affected.has(b.id)) {
                place(pack.filter(p => branchOf.get(p.id) === b.id), angle, center(root));
            }
        }
    }
    return result;
}
