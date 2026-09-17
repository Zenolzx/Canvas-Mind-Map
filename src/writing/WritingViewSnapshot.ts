import { DOCUMENT_ROOT, DocumentStructure } from '../document';
import { OrganicViewState, sourceFingerprint } from '../organic/OrganicViewState';

/** Only presentation and source anchors. Never Markdown contents or transaction history. */
export interface WritingViewSnapshot {
    fingerprint: string;
    selected: number | null;
    collapsed: number[];
    focus: number | null;
    styles: { start: number; color: string; side: number }[];
    viewport: { zoom: number; center: { x: number; y: number } };
}
export function normalizeWritingSnapshot(raw: unknown): WritingViewSnapshot | undefined {
    if (!raw || typeof raw !== 'object') return;
    const value = raw as WritingViewSnapshot, viewport = value.viewport;
    if (typeof value.fingerprint !== 'string' || value.fingerprint.length > 100 || !Array.isArray(value.collapsed) ||
        !Array.isArray(value.styles) || !viewport || !Number.isFinite(viewport.zoom) || viewport.zoom < .05 || viewport.zoom > 4 ||
        !Number.isFinite(viewport.center?.x) || !Number.isFinite(viewport.center?.y)) return;
    const offset = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= -1;
    return { fingerprint: value.fingerprint, selected: offset(value.selected) ? value.selected : null,
        focus: offset(value.focus) ? value.focus : null, collapsed: value.collapsed.filter(offset).slice(0, 10000),
        styles: value.styles.filter(s => s && offset(s.start) && typeof s.color === 'string' && /^#[\da-f]{6}$/i.test(s.color) && (s.side === 0 || s.side === 1))
            .slice(0, 10000).map(s => ({ start: s.start, color: s.color, side: s.side })),
        viewport: { zoom: viewport.zoom, center: { x: viewport.center.x, y: viewport.center.y } } };
}
export function captureWritingView(doc: DocumentStructure, state: OrganicViewState, viewport: WritingViewSnapshot['viewport']): WritingViewSnapshot {
    const start = (id: string | null) => id === DOCUMENT_ROOT ? -1 : id ? doc.sections.get(id)?.heading.start ?? null : null;
    return { fingerprint: sourceFingerprint(doc.text), selected: start(state.selectedNode), focus: start(state.focusNode),
        collapsed: [...state.collapsed].map(start).filter((offset): offset is number => offset !== null),
        styles: Object.entries(state.branchStyles).flatMap(([id, style]) => {
            const offset = start(id); return offset === null ? [] : [{ start: offset, ...style }];
        }), viewport };
}
export function restoreWritingView(raw: unknown, doc: DocumentStructure, state: OrganicViewState): WritingViewSnapshot['viewport'] | undefined {
    if (!raw || typeof raw !== 'object') return;
    const saved = raw as WritingViewSnapshot;
    if (saved.fingerprint !== sourceFingerprint(doc.text) || !Array.isArray(saved.collapsed) || !Array.isArray(saved.styles)) return;
    const ids = new Map([...doc.sections.values()].map(section => [section.heading.start, section.id]));
    ids.set(-1, DOCUMENT_ROOT);
    state.selectedNode = ids.get(saved.selected!) ?? DOCUMENT_ROOT;
    state.focusNode = ids.get(saved.focus!) ?? null;
    state.collapsed = new Set(saved.collapsed.slice(0, 10000).map(start => ids.get(start)).filter((id): id is string => !!id));
    state.branchStyles = Object.create(null);
    for (const style of saved.styles.slice(0, 10000)) {
        if (!style || !/^#[\da-f]{6}$/i.test(style.color) || (style.side !== 0 && style.side !== 1)) continue;
        const id = ids.get(style.start); if (id) state.branchStyles[id] = { color: style.color, side: style.side };
    }
    const viewport = saved.viewport;
    if (viewport && Number.isFinite(viewport.zoom) && viewport.zoom >= .05 && viewport.zoom <= 4 &&
        Number.isFinite(viewport.center?.x) && Number.isFinite(viewport.center?.y)) return viewport;
}
