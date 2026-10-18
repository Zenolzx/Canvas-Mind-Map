import type { OrganicLayoutResult, OrganicNode, Point } from '../organic/OrganicLayoutEngine';
import { svgElement } from '../organic/OrganicMindMapRenderer';
import { SKETCH_NOTE_PAPERS, SKETCH_PALETTE } from '../design/palette';
import { RADIUS } from '../design/geometry';
import type { SketchAnnotation, SketchState } from './ComposerModel';

const hash = (value: string): number => { let n = 2166136261; for (const ch of value) n = Math.imul(n ^ ch.charCodeAt(0), 16777619); return n >>> 0; };
const BRANCH_COLORS = SKETCH_PALETTE;
const NOTE_PAPERS = SKETCH_NOTE_PAPERS;
export const SKETCH_NOTE_SIZE = { width: 174, height: 86 } as const;
export const sketchBranchColor = (id: string): string => BRANCH_COLORS[hash(id) % BRANCH_COLORS.length] ?? BRANCH_COLORS[0]!;
const wobble = (key: string, size: number): number => ((hash(key) % 2001) / 1000 - 1) * size;
const center = (n: OrganicNode): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
export const sketchId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/** Applies saved positions after the normal structure layout. New headings keep their automatic position. */
export function sketchLayout(base: OrganicLayoutResult, state: SketchState): OrganicLayoutResult {
    const nodes = base.nodes.map(node => {
        const saved = state.positions[node.id];
        const drift = node.depth > 0 ? { x: wobble(`${node.id}:x`, 9), y: wobble(`${node.id}:y`, 13) } : { x: 0, y: 0 };
        const extra = node.depth === 0 ? { width: 28, height: 12, font: 2.5 } : node.depth === 1 ? { width: 12, height: 6, font: 1 } : { width: 0, height: 0, font: 0 };
        const savedX = saved?.x, savedY = saved?.y;
        return { ...node, width: node.width + extra.width, height: node.height + extra.height,
            fontSize: node.fontSize + extra.font,
            x: Number.isFinite(savedX) ? savedX! : node.x - extra.width / 2 + drift.x,
            y: Number.isFinite(savedY) ? savedY! : node.y - extra.height / 2 + drift.y };
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const branches = base.branches.map(branch => {
        const parent = byId.get(branch.parentId)!, child = byId.get(branch.childId)!;
        const a = center(parent), b = center(child), right = b.x >= a.x;
        const start = { x: right ? parent.x + parent.width : parent.x, y: a.y + wobble(`${branch.childId}:sy`, Math.min(6, parent.height / 7)) };
        const end = { x: right ? child.x : child.x + child.width, y: b.y + wobble(`${branch.childId}:ey`, Math.min(5, child.height / 7)) };
        const reach = Math.max(24, Math.abs(end.x - start.x) * .42), bend = wobble(`${branch.childId}:bend`, 18);
        return { ...branch, start, end,
            control1: { x: start.x + (right ? reach : -reach), y: start.y + bend },
            control2: { x: end.x - (right ? reach : -reach), y: end.y - bend * .65 },
            width: Math.max(1.15, Math.min(2.25, branch.width)) };
    });
    const all = [...nodes.map(n => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
        ...state.notes.map(n => ({ x: n.position.x, y: n.position.y, ...SKETCH_NOTE_SIZE }))];
    const left = Math.min(...all.map(n => n.x)) - 70, top = Math.min(...all.map(n => n.y)) - 70;
    return { ...base, nodes, branches, bounds: { x: left, y: top,
        width: Math.max(...all.map(n => n.x + n.width)) - left + 70,
        height: Math.max(...all.map(n => n.y + n.height)) - top + 70 } };
}

/**
 * Stable jitter seed for a hand-drawn stroke.
 *
 * The `wobble` function is seeded from its key, so deriving that key from an annotation id made
 * the drawn shape change every time a draft was reopened (ids are regenerated on load). Seed
 * from the kind plus the annotation's position in the saved list instead: per-annotation variety
 * is preserved, but a mark keeps its exact shape across sessions.
 */
const strokeSeed = (annotation: SketchAnnotation, index: number) => `${annotation.kind}:${index}`;

export function paintSketch(scene: SVGGElement, layout: OrganicLayoutResult, state: SketchState, selectedNote?: string, selectedAnnotation?: string, selectedLink?: string): void {
    scene.querySelector('.cmm-sketch-overlays')?.remove();
    scene.querySelector('.cmm-sketch-underlay')?.remove();
    const doc = scene.ownerDocument, overlay = svgElement(doc, 'g', { class: 'cmm-sketch-overlays' });
    const underlay = svgElement(doc, 'g', { class: 'cmm-sketch-underlay' });
    scene.insertBefore(underlay, scene.firstChild);
    scene.append(overlay);
    const nodes = new Map(layout.nodes.map(n => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
    for (const note of state.notes) nodes.set(note.id, { x: note.position.x, y: note.position.y, ...SKETCH_NOTE_SIZE });
    const seedOf = new Map(state.annotations.map((annotation, index) => [annotation.id, strokeSeed(annotation, index)]));
    const seedFor = (annotation: SketchAnnotation) => seedOf.get(annotation.id) ?? strokeSeed(annotation, 0);
    for (const link of state.links) {
        const from = nodes.get(link.from), to = nodes.get(link.to); if (!from || !to) continue;
        const path = svgElement(doc, 'path', { d: sketchLinkPath(link.id, from, to),
            class: `cmm-sketch-link${selectedLink === link.id ? ' is-selected' : ''}`, 'data-link-id': link.id }); overlay.append(path);
    }
    for (const annotation of state.annotations.filter(a => !a.anchorId)) {
        const group = sketchAnnotationElement(doc, annotation, selectedAnnotation === annotation.id, seedFor(annotation));
        (annotation.kind === 'highlight' ? underlay : overlay).append(group);
    }
    for (const note of state.notes) {
        const group = svgElement(doc, 'g', { class: `cmm-sketch-note${selectedNote === note.id ? ' is-selected' : ''}`, 'data-free-note-id': note.id,
            transform: `translate(${note.position.x} ${note.position.y})` });
        group.style.setProperty('--cmm-note-paper', NOTE_PAPERS[hash(note.id) % NOTE_PAPERS.length] ?? NOTE_PAPERS[0]!);
        group.append(svgElement(doc, 'rect', { class: 'cmm-sketch-note-paper', x: 1, y: 1, width: SKETCH_NOTE_SIZE.width - 2, height: SKETCH_NOTE_SIZE.height - 2, rx: RADIUS.m }));
        group.append(svgElement(doc, 'path', { class: 'cmm-sketch-note-accent', d: `M13 9 L${SKETCH_NOTE_SIZE.width - 13} 9` }));
        for (const annotation of state.annotations.filter(a => a.anchorId === note.id))
            group.append(sketchAnnotationElement(doc, annotation, selectedAnnotation === annotation.id, seedFor(annotation)));
        const label = svgElement(doc, 'text', { x: 14, y: 31 }); label.textContent = note.title.slice(0, 22); group.append(label);
        const preview = svgElement(doc, 'text', { x: 14, y: 57, class: 'cmm-sketch-note-preview' }); preview.textContent = note.body.replace(/\s+/g, ' ').slice(0, 24); group.append(preview);
        overlay.append(group);
    }
    for (const node of layout.nodes) {
        const group = scene.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
        if (!group) continue;
        group.classList.add('cmm-sketch-structural');
        group.style.setProperty('--cmm-sketch-branch', node.depth === 0 ? (BRANCH_COLORS[0] ?? '#668f86') : sketchBranchColor(node.rootBranchId ?? node.id));
        const outline = node.depth < 2 ? svgElement(doc, 'path', { d: roughOutline(node.width, node.height, node.id), class: 'cmm-sketch-outline' }) : svgElement(doc, 'path', { d: `M8 ${node.height - 3} Q${node.width / 2} ${node.height + wobble(node.id, 3)} ${node.width - 8} ${node.height - 3}`, class: 'cmm-sketch-underline' });
        group.querySelector('[role=link]')?.insertBefore(outline, group.querySelector('.cmm-organic-hitbox')?.nextSibling ?? null);
        if (node.depth === 0 && !state.annotations.some(mark => mark.anchorId === node.id && mark.kind === 'ellipse')) group.querySelector('[role=link]')?.insertBefore(svgElement(doc, 'path', { d: roughOutline(node.width + 5, node.height + 3, node.id + ':echo'), class: 'cmm-sketch-outline-echo', transform: 'translate(-2.5 -1.5)' }), outline);
        const link = group.querySelector('[role=link]');
        for (const annotation of state.annotations.filter(a => a.anchorId === node.id))
            link?.insertBefore(sketchAnnotationElement(doc, annotation, selectedAnnotation === annotation.id, seedFor(annotation)), link.querySelector('text'));
    }
}
export function sketchAnnotationElement(doc: Document, annotation: SketchAnnotation, selected = false, seed?: string): SVGGElement {
    const { start: a, end: b } = annotation;
    // Fall back to the id so a standalone preview still draws; saved marks pass a stable seed.
    const key = seed ?? annotation.id;
    const group = svgElement(doc, 'g', { class: `cmm-sketch-annotation is-${annotation.kind}${selected ? ' is-selected' : ''}`, 'data-annotation-id': annotation.id });
    if (annotation.kind === 'text') {
        const characters = Array.from((annotation.text ?? '').replace(/\s+/g, ' ').trim());
        const label = characters.length > 42 ? `${characters.slice(0, 41).join('')}…` : characters.join('');
        // eslint-disable-next-line no-control-regex -- control characters must be detected in this validator
        const width = Math.max(48, Math.min(360, Array.from(label).reduce((size, character) => size + (/[^\u0000-\u00ff]/.test(character) ? 13 : 7), 20)));
        group.append(svgElement(doc, 'rect', { class: 'cmm-sketch-caption-paper', x: a.x - 9, y: a.y - 19, width, height: 29, rx: RADIUS.xs }));
        const text = svgElement(doc, 'text', { x: a.x, y: a.y, class: 'cmm-sketch-caption' }); text.textContent = label; group.append(text);
    } else {
        let shape: SVGElement;
        if (annotation.kind === 'ellipse') {
            shape = svgElement(doc, 'ellipse', { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.max(6, Math.abs(b.x - a.x) / 2), ry: Math.max(6, Math.abs(b.y - a.y) / 2) });
        } else {
            const curve = annotation.kind === 'highlight' ? 2 : 9;
            shape = svgElement(doc, 'path', { d: `M${a.x} ${a.y} Q${(a.x + b.x) / 2 + wobble(key, curve)} ${(a.y + b.y) / 2 + wobble(`${key}y`, curve)} ${b.x} ${b.y}` });
        }
        shape.classList.add('cmm-sketch-mark'); group.append(shape);
        const hit = shape.cloneNode() as SVGElement; hit.classList.replace('cmm-sketch-mark', 'cmm-sketch-mark-hit'); group.append(hit);
        if (annotation.kind === 'arrow') {
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            group.append(svgElement(doc, 'path', { class: 'cmm-sketch-arrow-tip', d: `M${b.x - 11 * Math.cos(angle - .5)} ${b.y - 11 * Math.sin(angle - .5)} L${b.x} ${b.y} L${b.x - 11 * Math.cos(angle + .5)} ${b.y - 11 * Math.sin(angle + .5)}` }));
        }
        if (selected) {
            group.append(svgElement(doc, 'circle', { class: 'cmm-sketch-handle', 'data-endpoint': 'start', cx: a.x, cy: a.y, r: 5 }));
            group.append(svgElement(doc, 'circle', { class: 'cmm-sketch-handle', 'data-endpoint': 'end', cx: b.x, cy: b.y, r: 5 }));
        }
    }
    return group;
}
export function paintSketchPreview(scene: SVGGElement, annotation?: SketchAnnotation): void {
    scene.querySelector('.cmm-sketch-preview')?.remove();
    if (!annotation) return;
    const group = sketchAnnotationElement(scene.ownerDocument, annotation);
    group.classList.add('cmm-sketch-preview'); scene.append(group);
}
function sketchLinkPath(id: string, from: { x: number; y: number; width: number; height: number }, to: typeof from): string {
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }, b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const edge = (box: typeof from) => Math.min((box.width / 2 + 3) / Math.max(1, Math.abs(dx)), (box.height / 2 + 3) / Math.max(1, Math.abs(dy)));
    const first = edge(from), last = edge(to);
    const start = { x: a.x + dx * first, y: a.y + dy * first };
    const end = { x: b.x - dx * last, y: b.y - dy * last };
    const curve = wobble(id, 16);
    return `M${start.x} ${start.y} Q${(start.x + end.x) / 2 + curve} ${(start.y + end.y) / 2 - curve} ${end.x} ${end.y}`;
}
/** Move a note and its auxiliary links without laying out the entire document on every pointer event. */
export function paintSketchNoteMove(scene: SVGGElement, layout: OrganicLayoutResult, state: SketchState, noteId: string): void {
    const note = state.notes.find(item => item.id === noteId); if (!note) return;
    scene.querySelector<SVGGElement>(`[data-free-note-id="${CSS.escape(noteId)}"]`)?.setAttribute('transform', `translate(${note.position.x} ${note.position.y})`);
    const bounds = (id: string) => {
        const free = state.notes.find(item => item.id === id);
        return free ? { x: free.position.x, y: free.position.y, ...SKETCH_NOTE_SIZE } : layout.nodes.find(node => node.id === id);
    };
    for (const link of state.links) {
        if (link.from !== noteId && link.to !== noteId) continue;
        const from = bounds(link.from), to = bounds(link.to); if (!from || !to) continue;
        scene.querySelector<SVGPathElement>(`[data-link-id="${CSS.escape(link.id)}"]`)?.setAttribute('d', sketchLinkPath(link.id, from, to));
    }
}
function roughOutline(w: number, h: number, id: string): string {
    const r = Math.min(h / 2, 27), j = (part: string) => wobble(id + part, 1.8);
    return `M${r} ${1 + j('a')} C${w * .34} ${j('b')} ${w * .68} ${j('c')} ${w - r} ${1 + j('d')} C${w - r * .35} ${j('e')} ${w + j('f')} ${r * .65} ${w - 1 + j('g')} ${h / 2} C${w + j('h')} ${h - r * .3} ${w - r * .4} ${h + j('i')} ${w - r} ${h - 1 + j('j')} C${w * .68} ${h + j('k')} ${w * .32} ${h + j('l')} ${r} ${h - 1 + j('m')} C${r * .35} ${h + j('n')} ${j('o')} ${h - r * .5} ${1 + j('p')} ${h / 2} C${j('q')} ${r * .5} ${r * .3} ${j('r')} ${r} ${1 + j('a')} Z`;
}
