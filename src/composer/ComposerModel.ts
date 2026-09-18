import type { MindMapModel, MindMapNode } from '../core/MindMapModel';
import type { OrganicLayoutStyle } from '../organic/OrganicViewState';
import { DocumentStructureParser } from '../document';

export interface ComposerNode {
    id: string; title: string; body: string; children: ComposerNode[];
    type: 'heading' | 'idea' | 'todo'; checked?: boolean; collapsed: boolean; metadata: Record<string, unknown>;
}
export interface ComposerDraft {
    schemaVersion: 1; draftId: string; root: ComposerNode; rootAsHeading: boolean;
    targetFolder: string; createdAt: number; updatedAt: number;
    layout: OrganicLayoutStyle; selection: string; panel: 'auto' | 'show' | 'hide'; panelWidth: number;
    viewport?: { zoom: number; center: { x: number; y: number } };
    createdPath?: string;
    unsorted?: ComposerNode[]; selections?: string[]; focusNode?: string | null; frontmatter?: string;
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function newNode(title = 'New idea', type: ComposerNode['type'] = 'heading'): ComposerNode {
    return { id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, title, body: '', children: [], type, collapsed: false, metadata: {} };
}
export function newDraft(targetFolder = ''): ComposerDraft {
    const root = newNode('Untitled');
    return { schemaVersion: 1, draftId: `draft-${root.id}`, root, rootAsHeading: false, targetFolder,
        createdAt: Date.now(), updatedAt: Date.now(), layout: 'organic-horizontal', selection: root.id, panel: 'auto', panelWidth: .35 };
}
export function normalizeDraft(raw: unknown): ComposerDraft {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid draft.');
    const draft = clone(raw) as ComposerDraft;
    if (draft.schemaVersion !== 1 || typeof draft.draftId !== 'string' || !draft.draftId || typeof draft.targetFolder !== 'string') throw new Error('Unsupported draft format.');
    draft.rootAsHeading = draft.rootAsHeading === true;
    validate(draft);
    const all = entries(draft, true);
    for (const { node } of all) {
        if (!['heading', 'idea', 'todo'].includes(node.type ?? 'heading')) throw new Error('Unsupported node type.');
        node.type = node.type ?? 'heading'; node.collapsed = node.collapsed === true; node.checked = node.checked === true;
        node.metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    }
    draft.unsorted = draft.unsorted ?? [];
    draft.selections = Array.isArray(draft.selections) ? draft.selections.filter(id => all.some(e => e.node.id === id)) : [];
    if (!all.some(e => e.node.id === draft.focusNode && !e.unsorted)) draft.focusNode = null;
    if (typeof draft.frontmatter !== 'string') draft.frontmatter = '';
    if (!all.some(e => e.node.id === draft.selection)) draft.selection = draft.root.id;
    if (!['organic-horizontal', 'organic-radial', 'compact-organic'].includes(draft.layout)) draft.layout = 'organic-horizontal';
    if (!['auto', 'show', 'hide'].includes(draft.panel)) draft.panel = 'auto';
    draft.panelWidth = Number.isFinite(draft.panelWidth) ? Math.max(.2, Math.min(.7, draft.panelWidth)) : .35;
    if (!Number.isFinite(draft.updatedAt)) draft.updatedAt = Date.now();
    if (!Number.isFinite(draft.createdAt)) draft.createdAt = draft.updatedAt;
    const v = draft.viewport;
    if (!v || !Number.isFinite(v.zoom) || v.zoom < .05 || v.zoom > 4 || !Number.isFinite(v.center?.x) || !Number.isFinite(v.center?.y)) delete draft.viewport;
    if (typeof draft.createdPath !== 'string') delete draft.createdPath;
    return draft;
}
export function entries(draft: ComposerDraft, includeUnsorted = false): { node: ComposerNode; parent?: ComposerNode; depth: number; unsorted?: boolean }[] {
    const result: ReturnType<typeof entries> = [], seen = new Set<string>();
    const visit = (node: ComposerNode, depth: number, parent?: ComposerNode, unsorted = false) => {
        if (!node || typeof node.id !== 'string' || seen.has(node.id)) throw new Error('Duplicate or invalid node IDs.');
        if (depth > 6) throw new Error('Maximum Markdown heading depth reached.');
        seen.add(node.id); result.push({ node, parent, depth, unsorted });
        if (!Array.isArray(node.children) || typeof node.title !== 'string' || typeof node.body !== 'string') throw new Error('Invalid draft node.');
        for (const child of node.children) visit(child, depth + 1, node, unsorted);
    };
    visit(draft.root, 0);
    if (includeUnsorted) for (const node of draft.unsorted ?? []) visit(node, 1, undefined, true);
    return result;
}
export function validate(draft: ComposerDraft, exporting = false): void {
    for (const { node, depth } of entries(draft, true)) {
        if (depth + Number(draft.rootAsHeading) > 6) throw new Error('Maximum Markdown heading depth reached.');
        if (exporting && (!node.title.trim() || /[\r\n]/.test(node.title))) throw new Error('Every node needs a single-line title.');
    }
}
export function projectDraft(draft: ComposerDraft): MindMapModel {
    const nodes: MindMapNode[] = entries(draft).map(({ node, parent, depth }) => ({ id: node.id, key: node.id,
        title: `${node.type === 'idea' ? '? ' : node.type === 'todo' ? node.checked ? '☑ ' : '☐ ' : ''}${node.title || 'New idea'}`, content: node.body, headingLevel: depth + Number(draft.rootAsHeading), depth,
        parentId: parent?.id, children: node.children.map(n => n.id), source: { line: 0, endLine: 0 } }));
    return { rootId: draft.root.id, nodes };
}
export type DropPosition = 'before' | 'child' | 'after';
export function moveNode(draft: ComposerDraft, id: string, target: string, position: DropPosition): void {
    moveNodes(draft, [id], target, position);
}
export function selectedRoots(draft: ComposerDraft, ids: readonly string[]) {
    const selected = new Set(ids), all = entries(draft, true);
    return all.filter(entry => {
        if (!selected.has(entry.node.id) || entry.node === draft.root) return false;
        let parent = entry.parent;
        while (parent) { if (selected.has(parent.id) && parent !== draft.root) return false; parent = all.find(e => e.node === parent)?.parent; }
        return true;
    });
}
export function siblingsOf(draft: ComposerDraft, id: string): ComposerNode[] {
    const entry = entries(draft, true).find(e => e.node.id === id);
    if (!entry || entry.node === draft.root) throw new Error('Select a section or idea, not the document root.');
    return entry.parent?.children ?? (draft.unsorted ??= []);
}
export function moveNodes(draft: ComposerDraft, ids: readonly string[], target: string, position: DropPosition): void {
    const all = entries(draft, true), roots = selectedRoots(draft, ids), destination = all.find(e => e.node.id === target);
    if (!roots.length || !destination) throw new Error('Choose another destination.');
    let ancestor: ComposerNode | undefined = destination.node;
    while (ancestor) {
        if (roots.some(e => e.node === ancestor)) throw new Error('A branch cannot be moved into itself.');
        ancestor = all.find(e => e.node === ancestor)?.parent;
    }
    const siblings = position === 'child' ? destination.node.children : siblingsOf(draft, target);
    for (const entry of roots) { const source = siblingsOf(draft, entry.node.id); source.splice(source.indexOf(entry.node), 1); }
    const index = position === 'child' ? siblings.length : siblings.indexOf(destination.node) + Number(position === 'after');
    siblings.splice(index, 0, ...roots.map(e => e.node));
    if (position === 'child') destination.node.collapsed = false;
    validate(draft);
}
export function parkNodes(draft: ComposerDraft, ids: readonly string[]): void {
    const roots = selectedRoots(draft, ids);
    for (const { node } of roots) { const siblings = siblingsOf(draft, node.id); siblings.splice(siblings.indexOf(node), 1); }
    (draft.unsorted ??= []).push(...roots.map(e => e.node)); draft.focusNode = null;
}
export function createParent(draft: ComposerDraft, ids: readonly string[], title: string): string {
    if (!title.trim()) throw new Error('Enter a parent title.');
    const roots = selectedRoots(draft, ids);
    if (!roots.length) throw new Error('Select one or more sibling nodes.');
    const siblings = siblingsOf(draft, roots[0].node.id);
    if (roots.some(e => siblingsOf(draft, e.node.id) !== siblings)) throw new Error('Create parent requires nodes with the same parent.');
    const parent = newNode(title.trim()), index = siblings.indexOf(roots[0].node);
    parent.children = roots.map(e => e.node);
    for (const { node } of roots) siblings.splice(siblings.indexOf(node), 1);
    siblings.splice(index, 0, parent); draft.selection = parent.id; draft.selections = [parent.id]; validate(draft); return parent.id;
}
/** Atomic draft transactions: invalid changes never escape into the live document. */
export class ComposerHistory {
    private undoStack: ComposerDraft[] = [];
    private redoStack: ComposerDraft[] = [];
    private group = ''; private changedAt = 0;
    private editing?: ComposerDraft;
    constructor(public draft: ComposerDraft) { validate(draft); }
    beginEdit(): void { if (!this.editing) this.editing = clone(this.draft); }
    endEdit(cancel = false): void {
        if (!this.editing) return;
        if (cancel) this.draft = this.editing;
        else if (JSON.stringify(this.editing) !== JSON.stringify(this.draft)) { this.undoStack.push(this.editing); this.redoStack = []; }
        this.editing = undefined; this.group = '';
    }
    change(edit: (draft: ComposerDraft) => void, group = ''): void {
        const next = clone(this.draft); edit(next); validate(next);
        if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
        if (!this.editing && (!group || group !== this.group || Date.now() - this.changedAt > 800)) this.undoStack.push(clone(this.draft));
        this.group = group; this.changedAt = Date.now(); if (!this.editing) this.redoStack = [];
        next.updatedAt = Date.now(); this.draft = next;
    }
    undo(): void { const previous = this.undoStack.pop(); if (previous) { this.redoStack.push(clone(this.draft)); this.draft = previous; } this.group = ''; }
    redo(): void { const next = this.redoStack.pop(); if (next) { this.undoStack.push(clone(this.draft)); this.draft = next; } this.group = ''; }
}
/** Return exact heading offsets, so duplicate titles survive the Organic handoff. */
export interface ComposerExportOptions { ideas?: 'headings' | 'bullets' | 'exclude'; unsorted?: 'append' | 'exclude' }
export function exportMarkdown(draft: ComposerDraft, options: ComposerExportOptions = {}): { text: string; offsets: Map<string, number>; omitted: boolean } {
    validate(draft);
    if ((draft.unsorted?.length ?? 0) && !options.unsorted) throw new Error('Choose how to handle Unsorted Ideas before exporting.');
    const included = entries(draft, options.unsorted === 'append');
    if (included.some(e => e.node.type === 'idea') && !options.ideas) throw new Error('Choose how to export idea nodes, or review them individually.');
    let text = ''; const offsets = new Map<string, number>();
    const append = (block: string) => { if (block) text += `${block.replace(/\n+$/, '')}\n\n`; };
    if (draft.frontmatter?.trim()) {
        if (/^(---|\.\.\.)\s*$/m.test(draft.frontmatter)) throw new Error('Enter frontmatter YAML without --- delimiters.');
        append(`---\n${draft.frontmatter.trim()}\n---`);
    }
    let omitted = !!draft.unsorted?.length && options.unsorted === 'exclude';
    const title = (node: ComposerNode) => {
        if (!node.title.trim() || /[\r\n]/.test(node.title)) throw new Error('Every exported node needs a single-line title.');
        return node.title.trim();
    };
    const list = (node: ComposerNode, indent = 0): string => {
        if (node.type === 'idea' && options.ideas === 'exclude') { omitted = true; return ''; }
        const prefix = '  '.repeat(indent), marker = node.type === 'todo' ? `[${node.checked ? 'x' : ' '}] ` : '';
        let block = `${prefix}- ${marker}${title(node)}\n`;
        if (node.body.trim()) block += '\n' + node.body.replace(/\n+$/, '').split('\n').map(line => `${prefix}  ${line}`).join('\n') + '\n';
        for (const child of node.children) block += list(child, indent + 1);
        return block;
    };
    const visit = (node: ComposerNode, depth: number) => {
        if (node.type === 'idea' && options.ideas === 'exclude') { omitted = true; return; }
        if (depth && (node.type === 'todo' || (node.type === 'idea' && options.ideas === 'bullets'))) { append(list(node)); return; }
        if (depth || draft.rootAsHeading) { offsets.set(node.id, text.length); append(`${'#'.repeat(depth + Number(draft.rootAsHeading))} ${title(node)}`); }
        else offsets.set(node.id, -1);
        append(node.body); for (const child of node.children) visit(child, depth + 1);
    };
    visit(draft.root, 0);
    if (options.unsorted === 'append') for (const node of draft.unsorted ?? []) visit(node, 1);
    text = text.replace(/\n+$/, '') + (text ? '\n' : '');
    const parsed = new DocumentStructureParser().parse(text, { sourcePath: 'composer.md' });
    const expected = [...offsets.values()].filter(n => n >= 0);
    const actual = [...parsed.sections.values()].map(s => s.heading.start);
    if (parsed.diagnostics.length || expected.length !== actual.length || expected.some((n, i) => n !== actual[i]))
        throw new Error('Body Markdown changes the section structure. Move headings into mind map nodes and close any unfinished code fences.');
    return { text, offsets, omitted };
}
export function notePath(name: string, folder: string): string {
    const base = name.trim().replace(/\.md$/i, '');
    if (!base || /[<>:"/\\|?*\x00-\x1f]/.test(base) || /[. ]$/.test(base) || /^\.{1,2}$/.test(base) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))
        throw new Error('Enter a valid Markdown filename.');
    const location = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (location.split('/').some(part => part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part))) throw new Error('Enter a valid vault folder.');
    return `${location ? location + '/' : ''}${base}.md`;
}
