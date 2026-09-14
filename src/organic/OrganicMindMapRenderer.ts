import type { OrganicLayoutResult } from './OrganicLayoutEngine';

const NS = 'http://www.w3.org/2000/svg';
export function svgElement<K extends keyof SVGElementTagNameMap>(document: Document, name: K,
    attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
}

/** Draws supplied geometry only. No layout decisions or source/Canvas access. */
export class OrganicMindMapRenderer {
    render(container: SVGGElement, result: OrganicLayoutResult, actions: {
        navigate: (id: string) => void; toggle: (id: string) => void;
        toggleLabel: (collapsed: boolean) => string;
    }): void {
        const document = container.ownerDocument;
        container.replaceChildren();
        const edges = svgElement(document, 'g', { class: 'cmm-organic-branches', fill: 'none' });
        container.append(edges);
        for (const branch of result.branches) {
            const { start: s, control1: a, control2: b, end: e } = branch;
            edges.append(svgElement(document, 'path', {
                d: `M ${s.x} ${s.y} C ${a.x} ${a.y} ${b.x} ${b.y} ${e.x} ${e.y}`,
                stroke: branch.color, 'stroke-width': branch.width, 'stroke-linecap': 'round',
            }));
        }
        for (const node of result.nodes) {
            const group = svgElement(document, 'g', { transform: `translate(${node.x} ${node.y})`,
                class: `cmm-organic-node${node.depth === 0 ? ' is-root' : ''}`, 'data-node-id': node.id });
            container.append(group);
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
            const invoke = (event: Event) => { event.stopPropagation(); actions.navigate(node.id); };
            heading.addEventListener('click', invoke);
            heading.addEventListener('keydown', event => { if (event.key === 'Enter') invoke(event); });
            if (node.children) {
                const button = svgElement(document, 'g', { role: 'button', tabindex: 0,
                    'aria-label': `${actions.toggleLabel(node.collapsed)}: ${node.title}`,
                    'aria-expanded': String(!node.collapsed), class: 'cmm-organic-toggle',
                    transform: `translate(${node.width / 2} ${node.height + 9})` });
                button.append(svgElement(document, 'circle', { r: 9, stroke: node.color }));
                const label = svgElement(document, 'text', { 'text-anchor': 'middle', y: 4, fill: node.color, 'font-size': 13 });
                label.textContent = node.collapsed ? '+' : '−'; button.append(label);
                const toggle = (event: Event) => { event.preventDefault(); event.stopPropagation(); actions.toggle(node.id); };
                button.addEventListener('click', toggle);
                button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') toggle(event); });
                group.append(button);
            }
        }
    }
}
