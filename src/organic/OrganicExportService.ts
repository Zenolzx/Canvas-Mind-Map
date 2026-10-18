import type { OrganicLayoutResult } from './OrganicLayoutEngine';
import { DEFAULT_SURFACE, OrganicMindMapRenderer, svgElement, type OrganicSurfaceStyle } from './OrganicMindMapRenderer';

export interface OrganicPresentation {
    background: string; foreground: string; border: string; rootBackground: string;
    accent: string; highlight: string; fontFamily: string;
    /** Screen presentation also paints child cards and branch strokes; exports must match. */
    nodeBackground?: string; branch?: string; muted?: string;
    /**
     * The renderer writes design tokens (`var(--cmm-branch-3)`, `var(--cmm-ink)`) so that a
     * theme switch needs no relayout. An export has no stylesheet, so those have to be
     * substituted with the values the live view computed.
     */
    resolve?: (declaration: string) => string;
    surface?: OrganicSurfaceStyle;
}
export type OrganicRenderActions = Parameters<OrganicMindMapRenderer['render']>[2];

/** SVG is the shared export surface; PNG has no separate layout or drawing implementation. */
export class OrganicExportService {
    svg(document: Document, result: OrganicLayoutResult, presentation: OrganicPresentation,
        state: Partial<OrganicRenderActions> = {}): string {
        const b = result.bounds;
        const svg = svgElement(document, 'svg', { xmlns: 'http://www.w3.org/2000/svg',
            width: b.width, height: b.height, viewBox: `${b.x} ${b.y} ${b.width} ${b.height}` });
        svg.setAttribute('font-family', `${presentation.fontFamily}, "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif`);
        svg.append(svgElement(document, 'rect', { x: b.x, y: b.y, width: b.width, height: b.height, fill: presentation.background }));
        const scene = svgElement(document, 'g'); svg.append(scene);
        const renderer = new OrganicMindMapRenderer();
        // The surface carries the same geometry the screen uses, so a card's radius, fill and
        // border are already correct as attributes and must not be re-derived here.
        renderer.render(scene, result, { ...state, navigate: () => {}, toggle: () => {}, toggleLabel: () => '',
            duration: 0, surface: presentation.surface ?? DEFAULT_SURFACE });
        const resolve = presentation.resolve ?? ((declaration: string) => declaration);
        // Walk the tree rather than query: the substitution must not depend on what subset of
        // selectors the DOM surface in use happens to support.
        const substitute = (node: Element): void => {
            // Text nodes live in `children` in some DOM implementations; only elements carry colours.
            if (typeof node.getAttribute === 'function') {
                for (const attribute of ['fill', 'stroke', 'stop-color', 'color']) {
                    const value = node.getAttribute(attribute);
                    if (value?.includes('var(')) node.setAttribute(attribute, resolve(value));
                }
            }
            for (const child of Array.from(node.children ?? [])) substitute(child);
        };
        substitute(scene);
        // Only interaction states are layered by CSS on screen, so only those are re-applied.
        for (const group of Array.from(scene.querySelectorAll<SVGGElement>('[data-node-id]'))) {
            const rect = group.querySelector('rect');
            if (!rect) continue;
            if (group.classList.contains('is-match')) rect.setAttribute('fill', presentation.highlight);
            const active = group.classList.contains('is-current-match') || group.classList.contains('is-reading')
                || group.classList.contains('is-selected');
            if (active) { rect.setAttribute('stroke', presentation.accent); rect.setAttribute('stroke-width', '1.6'); }
        }
        for (const el of Array.from(scene.querySelectorAll('[tabindex], [role]'))) {
            el.removeAttribute('tabindex'); el.removeAttribute('role');
        }
        renderer.close();
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    }
    async png(document: Document, svg: string, result: OrganicLayoutResult, scale = 2): Promise<Blob> {
        const width = Math.ceil(result.bounds.width * scale), height = Math.ceil(result.bounds.height * scale);
        if (width > 32767 || height > 32767 || width * height > 128_000_000)
            throw new Error('PNG_TOO_LARGE');
        await document.fonts?.ready;
        const image = document.createElement('img');
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        try {
            await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG image decoding failed')); image.src = url; });
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
            context.drawImage(image, 0, 0, width, height);
            return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
        } finally { URL.revokeObjectURL(url); }
    }
}
