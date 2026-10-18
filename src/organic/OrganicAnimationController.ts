import type { OrganicBranch, OrganicLayoutResult, Point } from './OrganicLayoutEngine';

export function branchPath(b: OrganicBranch): string {
    return `M ${b.start.x} ${b.start.y} C ${b.control1.x} ${b.control1.y} ${b.control2.x} ${b.control2.y} ${b.end.x} ${b.end.y}`;
}
/** One cancellable transition. Cancelling commits its final frame and removes all exit ghosts. */
export class OrganicAnimationController {
    private finish?: () => void;
    cancel(): void { this.finish?.(); this.finish = undefined; }
    transition(container: SVGGElement, previous: OrganicLayoutResult | undefined, next: OrganicLayoutResult,
        duration: number, paint: () => void): void {
        this.cancel();
        const win = container.ownerDocument.defaultView;
        if (!previous || !duration || !win?.requestAnimationFrame || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { paint(); return; }
        const nextIds = new Set(next.nodes.map(n => n.id));
        const exits = Array.from(container.querySelectorAll<SVGGElement>('[data-node-id]'))
            .filter(el => !nextIds.has(el.getAttribute('data-node-id')!)).map(el => el.cloneNode(true) as SVGGElement);
        const exitPaths = Array.from(container.querySelectorAll<SVGPathElement>('[data-child-id]'))
            .filter(el => !nextIds.has(el.getAttribute('data-child-id')!)).map(el => el.cloneNode(true) as SVGPathElement);
        paint();
        for (const el of [...exits, ...exitPaths]) {
            el.setAttribute('aria-hidden', 'true'); el.classList.add('cmm-organic-exit-ghost');
            el.querySelectorAll('[tabindex]').forEach(child => child.removeAttribute('tabindex'));
            container.append(el);
        }
        const oldNodes = new Map(previous.nodes.map(n => [n.id, n]));
        const nextNodes = new Map(next.nodes.map(n => [n.id, n]));
        const oldEdges = new Map(previous.branches.map(b => [b.childId, b]));
        const nextEdges = new Map(next.branches.map(b => [b.childId, b]));
        // Climb to the nearest ancestor that survives the transition, in that ancestor's own
        // coordinate space. A departing node collapses into its parent instead of flying to (0,0).
        const anchor = (id: string, arriving: boolean): Point | undefined => {
            const edges = arriving ? nextEdges : oldEdges, nodes = arriving ? oldNodes : nextNodes;
            const survivors = arriving ? nextNodes : oldNodes;
            let edge = edges.get(id);
            while (edge) {
                const parent = nodes.get(edge.parentId);
                if (parent && survivors.has(edge.parentId))
                    return { x: parent.x + (edge.end.x >= edge.start.x ? parent.width : 0), y: parent.y + parent.height / 2 };
                edge = edges.get(edge.parentId);
            }
            return undefined;
        };
        // Last resort: keep an orphan exactly where it already is rather than yanking it to the origin.
        const current = (el: SVGGElement): Point => {
            const match = /translate\(\s*(-?[\d.eE+]+)[\s,]+(-?[\d.eE+]+)\s*\)/.exec(el.getAttribute('transform') ?? '');
            const x = match ? Number(match[1]) : 0, y = match ? Number(match[2]) : 0;
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 };
        };
        const mix = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        const nodes = Array.from(container.querySelectorAll<SVGGElement>('[data-node-id]')).map(el => {
            const id = el.getAttribute('data-node-id')!, a = oldNodes.get(id), b = nextNodes.get(id);
            const anchorId = a ? id : b ? id : undefined;
            const still = anchorId ? undefined : current(el);
            return { el, a: a ?? anchor(id, true) ?? still ?? current(el), b: b ?? anchor(id, false) ?? still ?? current(el),
                entering: !a, exiting: !b, opacity: win.getComputedStyle(el).opacity || '1' };
        });
        const template = next.branches[0];
        const paths = template ? Array.from(container.querySelectorAll<SVGPathElement>('[data-child-id]')).map(el => {
            const id = el.getAttribute('data-child-id')!, a = oldEdges.get(id), b = nextEdges.get(id);
            const point = anchor(id, !a) ?? { x: 0, y: 0 };
            const zero = { start: point, control1: point, control2: point, end: point };
            return { el, a: a ?? zero, b: b ?? zero, entering: !a, exiting: !b };
        }) : [];
        const frame = (t: number) => {
            for (const n of nodes) {
                const p = mix(n.a, n.b, t); n.el.setAttribute('transform', `translate(${p.x} ${p.y})`);
                n.el.setCssStyles({ opacity: String(Number(n.opacity) * (n.entering ? t : n.exiting ? 1 - t : 1)) });
            }
            if (!template) return;
            for (const p of paths) {
                p.el.setAttribute('d', branchPath({ ...template, start: mix(p.a.start, p.b.start, t),
                    control1: mix(p.a.control1, p.b.control1, t), control2: mix(p.a.control2, p.b.control2, t), end: mix(p.a.end, p.b.end, t) }));
                p.el.setCssStyles({ opacity: String(p.entering ? t : p.exiting ? 1 - t : 1) });
            }
        };
        let handle = 0; const started = win.performance.now();
        this.finish = () => { win.cancelAnimationFrame(handle); frame(1); exits.forEach(el => el.remove()); exitPaths.forEach(el => el.remove()); };
        const tick = (now: number) => {
            const t = Math.min(1, (now - started) / duration); frame(1 - Math.pow(1 - t, 3));
            if (t < 1) handle = win.requestAnimationFrame(tick); else this.cancel();
        };
        frame(0); handle = win.requestAnimationFrame(tick);
    }
}
