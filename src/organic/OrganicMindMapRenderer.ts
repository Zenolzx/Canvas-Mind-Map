import type { OrganicLayoutResult } from './OrganicLayoutEngine';
import { OrganicAnimationController } from './OrganicAnimationController';

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
        navigate: (id: string) => void; toggle: (id: string) => void;
        toggleLabel: (collapsed: boolean) => string;
        contextMenu?: (id: string, event: MouseEvent) => void;
        matches?: ReadonlySet<string>; currentMatch?: string; selected?: string | null;
        reading?: string | null; emphasized?: ReadonlySet<string>;
        duration?: number;
        previousTranslation?: { x: number; y: number };
        writingCounts?: ReadonlyMap<string, number>;
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
                if (toggle) this.actions?.toggle(id); else if (target.closest('[role="link"]')) this.actions?.navigate(id);
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
        const previous = this.previous && shift ? { ...this.previous,
            nodes: this.previous.nodes.map(n => ({ ...n, ...translate(n) })),
            branches: this.previous.branches.map(b => ({ ...b, start: translate(b.start), control1: translate(b.control1),
                control2: translate(b.control2), end: translate(b.end) })) } : this.previous;
        this.animation.transition(container, previous, result, actions.duration ?? 0, () => this.paint(container, result, actions));
        this.previous = result;
    }
    private paint(container: SVGGElement, result: OrganicLayoutResult, actions: Parameters<OrganicMindMapRenderer['render']>[2]): void {
        const document = container.ownerDocument;
        const existing = new Map(Array.from(container.querySelectorAll<SVGGElement>('[data-node-id]')).map(el => [el.getAttribute('data-node-id')!, el]));
        const ids = new Set(result.nodes.map(n => n.id));
        for (const [id, el] of existing) if (!ids.has(id)) el.remove();
        container.querySelector('.cmm-organic-branches')?.remove();
        const edges = svgElement(document, 'g', { class: 'cmm-organic-branches', fill: 'none' });
        container.append(edges);
        for (const branch of result.branches) {
            const { start: s, control1: a, control2: b, end: e } = branch;
            edges.append(svgElement(document, 'path', {
                d: `M ${s.x} ${s.y} C ${a.x} ${a.y} ${b.x} ${b.y} ${e.x} ${e.y}`,
                stroke: branch.color, 'stroke-width': branch.width, 'stroke-linecap': 'round',
                'data-child-id': branch.childId,
            }));
        }
        for (const node of result.nodes) {
            const group = existing.get(node.id) ?? svgElement(document, 'g', { 'data-node-id': node.id });
            group.replaceChildren(); group.style.opacity = '';
            group.setAttribute('transform', `translate(${node.x} ${node.y})`);
            group.setAttribute('class', `cmm-organic-node${node.depth === 0 ? ' is-root' : ''}`);
            container.append(group);
            if (actions.matches?.has(node.id)) group.classList.add('is-match');
            if (actions.currentMatch === node.id) group.classList.add('is-current-match');
            if (actions.selected === node.id) group.classList.add('is-selected');
            if (actions.reading === node.id) group.classList.add('is-reading');
            if (actions.emphasized && !actions.emphasized.has(node.id)) group.style.opacity = '0.22';
            const heading = svgElement(document, 'g', { role: 'link', tabindex: 0, 'aria-label': node.title });
            group.append(heading);
            heading.append(svgElement(document, 'rect', { width: node.width, height: node.height, rx: 18,
                class: 'cmm-organic-hitbox' }));
            const text = svgElement(document, 'text', { x: node.width / 2,
                'text-anchor': 'middle', fill: node.color, 'font-size': node.fontSize, 'font-weight': node.fontWeight });
            const top = (node.height - node.lines.length * node.fontSize * 1.4) / 2 + node.fontSize * 1.08;
            node.lines.forEach((line, i) => {
                const span = svgElement(document, 'tspan', { x: node.width / 2, y: top + i * node.fontSize * 1.4 });
                span.textContent = line; text.append(span);
            });
            heading.append(text);
            const count = actions.writingCounts?.get(node.id);
            if (count !== undefined) {
                const title = svgElement(document, 'title'); title.textContent = `${count} 字/词 · 直属正文`; group.append(title);
                group.append(svgElement(document, 'circle', { cx: node.width - 4, cy: 4, r: 2.5,
                    fill: count ? node.color : 'none', stroke: node.color, 'stroke-width': 1, class: 'cmm-writing-status' }));
            }
            if (node.children) {
                const button = svgElement(document, 'g', { role: 'button', tabindex: 0,
                    'aria-label': `${actions.toggleLabel(node.collapsed)}: ${node.title}`,
                    'aria-expanded': String(!node.collapsed), class: 'cmm-organic-toggle',
                    transform: `translate(${node.width / 2} ${node.height + 9})` });
                button.append(svgElement(document, 'circle', { r: 9, stroke: node.color }));
                const label = svgElement(document, 'text', { 'text-anchor': 'middle', y: 4, fill: node.color, 'font-size': 13 });
                label.textContent = node.collapsed ? '+' : '−'; button.append(label);
                group.append(button);
            }
        }
    }
}
