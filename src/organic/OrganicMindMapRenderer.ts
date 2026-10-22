import type { OrganicLayoutResult } from './OrganicLayoutEngine';
import { OrganicAnimationController } from './OrganicAnimationController';
import { RADIUS } from '../design/geometry';
import { EYEBROW_SIZE, EYEBROW_TRACKING, LINE_HEIGHT } from '../design/type';

/**
 * Baseline appearance for one render.
 *
 * These values are written as presentation attributes rather than left to styles.css. An
 * export serializes the SVG without any stylesheet, so anything the screen gets from CSS
 * would silently vanish from (or change in) the exported file. Attributes are the single
 * source of truth; CSS only layers interaction and appearance-preset overrides on top.
 *
 * Root and first-level cards have distinct hierarchy. Theme-aware boundaries and branch
 * washes are attributes too, so a stylesheet-free export retains the same visual structure.
 */
export interface OrganicSurfaceStyle {
    cardFill: string; rootFill: string; cardStroke: string; rootStroke: string;
    cardStrokeWidth: number; rootStrokeWidth: number;
    label: string; muted: string; branch: string; branchOpacity: number; radius: number;
    /** Hairline under a root title, and the badge backing that must not show the map through. */
    rule: string; paperFill: string;
    eyebrowSize: number; eyebrowTracking: number;
}
export const DEFAULT_SURFACE: OrganicSurfaceStyle = {
    cardFill: 'var(--cmm-node-fill, var(--cmm-paper-raised))',
    rootFill: 'var(--cmm-paper-raised)',
    cardStroke: 'var(--cmm-rule)',
    rootStroke: 'var(--cmm-accent)',
    cardStrokeWidth: .8, rootStrokeWidth: 1.4,
    label: 'var(--cmm-ink, var(--text-normal))',
    muted: 'var(--cmm-muted, var(--text-muted))',
    branch: 'var(--cmm-branch, var(--text-muted))',
    branchOpacity: .88, radius: RADIUS.m,
    rule: 'var(--cmm-rule, var(--background-modifier-border))',
    paperFill: 'var(--cmm-paper, var(--background-primary))',
    eyebrowSize: EYEBROW_SIZE, eyebrowTracking: EYEBROW_TRACKING,
};
const NS = 'http://www.w3.org/2000/svg';
export function svgElement<K extends keyof SVGElementTagNameMap>(document: Document, name: K,
    attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
}

/** Draws supplied geometry only. No layout decisions or source/Canvas access. */
export class OrganicMindMapRenderer {
    private animation = new OrganicAnimationController();
    private previous?: OrganicLayoutResult;
    private delegated = new WeakSet<SVGGElement>();
    private actions?: Parameters<OrganicMindMapRenderer['render']>[2];
    close(): void { this.animation.cancel(); }
    render(container: SVGGElement, result: OrganicLayoutResult, actions: {
        navigate: (id: string, event?: MouseEvent | KeyboardEvent) => void; toggle: (id: string) => void;
        toggleLabel: (collapsed: boolean) => string;
        contextMenu?: (id: string, event: MouseEvent) => void;
        matches?: ReadonlySet<string>; currentMatch?: string; selected?: string | null;
        reading?: string | null; emphasized?: ReadonlySet<string>;
        duration?: number;
        previousTranslation?: { x: number; y: number };
        writingCounts?: ReadonlyMap<string, number>;
        /** Small-caps label above the root title, e.g. the source file name. */
        eyebrow?: string;
        /** Baseline appearance. Supplied by the view so free/pinned layouts can flatten it. */
        surface?: OrganicSurfaceStyle;
    }): void {
        this.actions = actions;
        if (!this.delegated.has(container)) {
            this.delegated.add(container);
            const invoke = (event: MouseEvent | KeyboardEvent) => {
                const target = event.target as Element;
                const group = target.closest('[data-node-id]');
                if (!group || group.getAttribute('aria-hidden') === 'true') return;
                const id = group.getAttribute('data-node-id')!;
                const toggle = target.closest('[role="button"]');
                if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Enter' && !(toggle && (event as KeyboardEvent).key === ' ')) return;
                event.preventDefault(); event.stopPropagation();
                if (toggle) this.actions?.toggle(id); else if (target.closest('[role="link"]')) this.actions?.navigate(id, event);
            };
            container.addEventListener('click', invoke); container.addEventListener('keydown', invoke);
            container.addEventListener('contextmenu', event => {
                const group = (event.target as Element).closest('[data-node-id]');
                if (!group || !this.actions?.contextMenu) return;
                event.preventDefault(); event.stopPropagation(); this.actions.contextMenu(group.getAttribute('data-node-id')!, event);
            });
        }
        const shift = actions.previousTranslation;
        const translate = (point: { x: number; y: number }) => ({ x: point.x + shift!.x, y: point.y + shift!.y });
        // The anchor-preserving pan is already applied to the live transform, so the outgoing
        // geometry must be re-expressed in the incoming coordinate space before interpolating.
        const baseline = this.previous && shift ? { ...this.previous,
            nodes: this.previous.nodes.map(n => ({ ...n, ...translate(n) })),
            branches: this.previous.branches.map(b => ({ ...b, start: translate(b.start), control1: translate(b.control1),
                control2: translate(b.control2), end: translate(b.end) })) } : this.previous;
        this.animation.transition(container, baseline, result, actions.duration ?? 0, () => this.paint(container, result, actions));
        this.previous = result;
    }
    private paint(container: SVGGElement, result: OrganicLayoutResult, actions: Parameters<OrganicMindMapRenderer['render']>[2]): void {
        const document = container.ownerDocument;
        const surface = actions.surface ?? DEFAULT_SURFACE;
        const existing = new Map(Array.from(container.querySelectorAll<SVGGElement>('[data-node-id]')).map(el => [el.getAttribute('data-node-id')!, el]));
        const ids = new Set(result.nodes.map(n => n.id));
        for (const [id, el] of existing) if (!ids.has(id)) el.remove();
        container.querySelector('.cmm-organic-branches')?.remove();
        const edges = svgElement(document, 'g', { class: 'cmm-organic-branches', fill: 'none' });
        container.append(edges);
        for (const branch of result.branches) {
            const { start: s, control1: a, control2: b, end: e } = branch;
            const d = `M ${s.x} ${s.y} C ${a.x} ${a.y} ${b.x} ${b.y} ${e.x} ${e.y}`;
            // One stroke per connector. A translucent offset duplicate used to fake depth; the
            // width taper already expresses depth, and the duplicate was the only effect an
            // export could not reproduce.
            edges.append(svgElement(document, 'path', {
                d, stroke: branch.color, 'stroke-width': branch.width, 'stroke-linecap': 'round',
                'stroke-linejoin': 'round', opacity: surface.branchOpacity, 'data-child-id': branch.childId,
            }));
        }
        for (const node of result.nodes) {
            const group = existing.get(node.id) ?? svgElement(document, 'g', { 'data-node-id': node.id });
            group.replaceChildren(); group.setCssStyles({ opacity: '' });
            group.setAttribute('transform', `translate(${node.x} ${node.y})`);
            group.setAttribute('data-cmm-depth', String(node.depth));
            group.setAttribute('class', `cmm-organic-node${node.depth === 0 ? ' is-root' : ''}`);
            container.append(group);
            if (actions.matches?.has(node.id)) group.classList.add('is-match');
            if (actions.currentMatch === node.id) group.classList.add('is-current-match');
            if (actions.selected === node.id) group.classList.add('is-selected');
            if (actions.reading === node.id) group.classList.add('is-reading');
            if (actions.emphasized && !actions.emphasized.has(node.id)) group.classList.add('cmm-organic-node-dimmed');
            const root = node.depth === 0;
            const heading = svgElement(document, 'g', { role: 'link', tabindex: 0, 'aria-label': node.title });
            group.append(heading);
            // The rect stays even for a borderless card: it is the pointer target and the box the
            // selection ring is drawn on from CSS.
            heading.append(svgElement(document, 'rect', { width: node.width, height: node.height,
                rx: Math.min(surface.radius, node.height / 2), class: 'cmm-organic-hitbox',
                fill: root ? surface.rootFill : surface.cardFill,
                stroke: root ? surface.rootStroke : surface.cardStroke,
                'stroke-width': root ? surface.rootStrokeWidth : surface.cardStrokeWidth }));
            if ((root || node.depth === 1) && surface.cardStrokeWidth > 0) {
                heading.append(svgElement(document, 'rect', { width: node.width, height: node.height,
                    rx: Math.min(surface.radius, node.height / 2), fill: root ? surface.rootStroke : node.color,
                    'fill-opacity': root ? .09 : .075, 'pointer-events': 'none', class: 'cmm-organic-branch-wash' }));
                if (!root) heading.append(svgElement(document, 'rect', { x: 0, y: 9, width: 3,
                    height: Math.max(8, node.height - 18), rx: 1.5, fill: node.color, 'pointer-events': 'none', class: 'cmm-organic-branch-mark' }));
            }
            const blockHeight = node.lines.length * node.fontSize * LINE_HEIGHT;
            // A root is a sheet header: a small-caps label, the title, and a hairline rule. The
            // label gets its own band so the title block stays optically centred below it.
            const eyebrow = root ? actions.eyebrow : undefined;
            const band = eyebrow ? surface.eyebrowSize * 1.8 : 0;
            if (eyebrow) {
                const label = svgElement(document, 'text', { x: node.width / 2, 'text-anchor': 'middle',
                    y: surface.eyebrowSize + 2, fill: surface.muted, 'font-size': surface.eyebrowSize,
                    'font-weight': 600, 'letter-spacing': surface.eyebrowTracking * surface.eyebrowSize,
                    class: 'cmm-organic-eyebrow' });
                label.textContent = eyebrow;
                heading.append(label);
            }
            const text = svgElement(document, 'text', { x: node.width / 2, 'text-anchor': 'middle',
                fill: surface.label, 'font-size': node.fontSize, 'font-weight': node.fontWeight });
            const top = band + (node.height - band - blockHeight) / 2 + node.fontSize * 1.08;
            node.lines.forEach((line, i) => {
                const span = svgElement(document, 'tspan', { x: node.width / 2, y: top + i * node.fontSize * LINE_HEIGHT });
                span.textContent = line; text.append(span);
            });
            heading.append(text);
            if (root) heading.append(svgElement(document, 'line', { x1: 14, x2: node.width - 14, y1: node.height - 1.5,
                y2: node.height - 1.5, stroke: surface.rule, 'stroke-width': 1, class: 'cmm-organic-head-rule' }));
            const count = actions.writingCounts?.get(node.id);
            if (count !== undefined) {
                const title = svgElement(document, 'title'); title.textContent = `${count} 字/词 · 直属正文`; group.append(title);
                // Sits inside the card corner instead of straddling its edge.
                group.append(svgElement(document, 'circle', { cx: 9, cy: 9, r: 2.5,
                    fill: count ? surface.branch : 'none', stroke: surface.branch, 'stroke-width': 1, class: 'cmm-writing-status' }));
            }
            if (node.children) toggleBadge(document, group, surface, node, actions.toggleLabel);
        }
    }
}

/**
 * Disclosure badge for a node with children: a chevron inside a circular hit target.
 * Written entirely as attributes so the export keeps the same affordance without CSS.
 */
function toggleBadge(document: Document, group: SVGGElement, surface: OrganicSurfaceStyle,
    node: OrganicLayoutResult['nodes'][number], toggleLabel: (collapsed: boolean) => string): void {
    const accent = node.color === surface.label ? surface.branch : node.color;
    const badge = svgElement(document, 'g', { role: 'button', tabindex: 0,
        'aria-label': `${toggleLabel(node.collapsed)}: ${node.title}`,
        'aria-expanded': String(!node.collapsed), class: 'cmm-organic-toggle',
        transform: `translate(${node.width / 2} ${node.height + 11})` });
    badge.append(svgElement(document, 'circle', { r: 9, fill: surface.paperFill, stroke: accent, 'stroke-width': 1 }));
    badge.append(svgElement(document, 'path', {
        d: node.collapsed ? 'M -3.5 -1.5 L 0 2 L 3.5 -1.5' : 'M -3.5 1.5 L 0 -2 L 3.5 1.5',
        fill: 'none', stroke: accent, 'stroke-width': 1.7,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    group.append(badge);
}
