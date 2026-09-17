import type { OrganicLayoutResult } from './OrganicLayoutEngine';
import { OrganicMindMapRenderer, svgElement } from './OrganicMindMapRenderer';

export interface OrganicPresentation {
    background: string; foreground: string; border: string; rootBackground: string;
    accent: string; highlight: string; fontFamily: string;
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
        renderer.render(scene, result, { ...state, navigate: () => {}, toggle: () => {}, toggleLabel: () => '', duration: 0 });
        for (const group of Array.from(scene.querySelectorAll<SVGGElement>('[data-node-id]'))) {
            const rect = group.querySelector('rect')!;
            const root = group.classList.contains('is-root');
            rect.setAttribute('fill', group.classList.contains('is-match') ? presentation.highlight : root ? presentation.rootBackground : 'none');
            const active = group.classList.contains('is-current-match') || group.classList.contains('is-reading');
            rect.setAttribute('stroke', active || group.classList.contains('is-selected') ? presentation.accent : root ? presentation.border : 'none');
            rect.setAttribute('stroke-width', active ? '3' : '1.5');
            if (root) group.querySelector('text')?.setAttribute('fill', presentation.foreground);
            for (const circle of Array.from(group.querySelectorAll('circle'))) circle.setAttribute('fill', presentation.background);
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
