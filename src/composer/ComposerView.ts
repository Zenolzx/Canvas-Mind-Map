import { App, ItemView, Menu, Modal, Notice, parseYaml, Scope, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { OrganicLayoutEngine, OrganicLayoutResult } from '../organic/OrganicLayoutEngine';
import { OrganicMindMapRenderer, svgElement } from '../organic/OrganicMindMapRenderer';
import { OrganicViewportController } from '../organic/OrganicViewportController';
import { ORGANIC_VIEW, OrganicMindMapView } from '../organic/OrganicMindMapView';
import { sourceFingerprint } from '../organic/OrganicViewState';
import { clone, ComposerDraft, ComposerExportOptions, ComposerHistory, ComposerNode, createParent, DropPosition, entries, exportMarkdown, moveNodes, newDraft, newNode, normalizeDraft, notePath, parkNodes, selectedRoots, siblingsOf } from './ComposerModel';
import { ComposerStore } from './ComposerStore';
import { COMPOSER_TEMPLATES, composerProjection, deleteSelection, draftStatistics, duplicateDraft, fromTemplate, organizeSelection, outlineMarkdown, SearchScope, searchDraft } from './ComposerTools';

export const COMPOSER_VIEW = 'canvas-mind-map-composer';
export class ComposerView extends ItemView {
    private history = new ComposerHistory(newDraft());
    private get draft() { return this.history.draft; }
    private engine = new OrganicLayoutEngine();
    private renderer = new OrganicMindMapRenderer();
    private viewport = new OrganicViewportController();
    private result?: OrganicLayoutResult;
    private svg!: SVGSVGElement; private scene!: SVGGElement;
    private stage!: HTMLElement; private panel!: HTMLElement; private body!: HTMLTextAreaElement;
    private breadcrumb!: HTMLElement; private status!: HTMLElement; private split!: HTMLElement;
    private nameInput?: HTMLInputElement; private finishName?: (cancel?: boolean) => void;
    private autoPanel = false; private creating = false; private closed = false;
    private initialized = false; private dragCleanup?: () => void;
    private drawer!: HTMLElement; private drawerList!: HTMLElement; private drawerOpen = false;
    private searchBar!: HTMLElement; private searchInput!: HTMLInputElement; private searchLabel!: HTMLElement;
    private query = ''; private searchScope: SearchScope = 'titles'; private searchIndex = 0;
    private focusButton!: HTMLButtonElement; private typeInput!: HTMLSelectElement; private todoButton!: HTMLButtonElement;
    private selectionAnchor?: string;
    private get selected(): string[] {
        const valid = new Set(entries(this.draft, true).map(e => e.node.id));
        const ids = (this.draft.selections ?? [this.draft.selection]).filter(id => valid.has(id));
        return ids.length ? ids : [this.draft.selection];
    }
    constructor(leaf: WorkspaceLeaf, private store: ComposerStore) { super(leaf); }
    getViewType(): string { return COMPOSER_VIEW; }
    getDisplayText(): string { return `${this.draft.root.title || 'Untitled'} · Composer`; }
    getIcon(): string { return 'file-plus-2'; }
    focusMap(): void { this.stage.focus(); }
    getState(): Record<string, unknown> { return { draftId: this.draft.draftId }; }
    async setState(state: { draftId?: string; targetFolder?: string }, result: { history: boolean }): Promise<void> {
        const draft = state.draftId && this.store.data[state.draftId];
        if (state.draftId && !draft) { new Notice('This draft could not be found. Open a saved draft from Restore Composer Draft.'); }
        this.history = new ComposerHistory(draft ? clone(draft) : this.store.create(state.targetFolder));
        this.initialized = true; this.store.put(this.draft);
        this.render();
        if (this.draft.viewport) {
            this.viewport.scale = this.draft.viewport.zoom;
            this.viewport.center(this.draft.viewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
        } else this.fit();
        await super.setState(state, result);
    }
    async onOpen(): Promise<void> {
        this.contentEl.empty(); this.contentEl.addClass('cmm-organic-view', 'cmm-composer');
        this.scope = new Scope(this.app.scope);
        this.scope.register(['Mod'], 'f', event => { if (event.target === this.body || event.target === this.nameInput) return true; this.openSearch(); return false; });
        for (const [modifiers, key] of [[['Mod'], 'z'], [['Mod', 'Shift'], 'z'], [['Mod'], 'Enter']] as const)
            this.scope.register([...modifiers], key, event => { if (event.target === this.nameInput) return true; this.key(event); return false; });
        const toolbar = this.contentEl.createDiv({ cls: 'cmm-composer-toolbar' });
        toolbar.createEl('strong', { text: 'COMPOSER' });
        const layout = toolbar.createEl('select', { attr: { 'aria-label': 'Layout' } });
        for (const [value, text] of [['organic-horizontal', 'Horizontal'], ['organic-radial', 'Radial'], ['compact-organic', 'Compact']]) layout.createEl('option', { text, value });
        layout.onchange = () => { this.draft.layout = layout.value as ComposerDraft['layout']; this.render(); this.remember(); };
        const panel = toolbar.createEl('select', { attr: { 'aria-label': 'Body panel' } });
        for (const value of ['auto', 'show', 'hide']) panel.createEl('option', { text: `Body: ${value}`, value });
        panel.onchange = () => { this.draft.panel = panel.value as ComposerDraft['panel']; this.applyPanel(); this.ensureVisible(); this.remember(); };
        this.button(toolbar, '−', () => this.zoom(.85)); this.button(toolbar, '+', () => this.zoom(1.18)); this.button(toolbar, 'Fit', () => this.fit());
        this.button(toolbar, 'Search', () => this.openSearch());
        this.focusButton = this.button(toolbar, 'Focus', () => this.focusBranch());
        this.button(toolbar, 'Unsorted Ideas', () => { this.drawerOpen = !this.drawerOpen; this.renderDrawer(); });
        this.button(toolbar, '⋯', event => this.documentMenu(event));
        this.button(toolbar, 'Create Note', () => this.createNote()).addClass('mod-cta');
        this.searchBar = this.contentEl.createDiv({ cls: 'cmm-composer-search' }); this.searchBar.hidden = true;
        this.searchInput = this.searchBar.createEl('input', { type: 'search', attr: { placeholder: 'Search document and unsorted ideas', 'aria-label': 'Search Composer' } });
        const scope = this.searchBar.createEl('select', { attr: { 'aria-label': 'Search scope' } });
        for (const [value, text] of [['titles', 'Titles'], ['bodies', 'Bodies'], ['everything', 'Everything']]) scope.createEl('option', { value, text });
        scope.onchange = () => { this.searchScope = scope.value as SearchScope; this.searchIndex = 0; this.searchJump(); };
        this.searchInput.oninput = () => { this.query = this.searchInput.value; this.searchIndex = 0; this.searchJump(); };
        this.searchInput.onkeydown = event => { if (event.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.searchIndex += event.shiftKey ? -1 : 1; this.searchJump(); } else if (event.key === 'Escape') { event.stopPropagation(); this.closeSearch(); } };
        this.searchLabel = this.searchBar.createSpan();
        this.button(this.searchBar, 'Previous', () => { this.searchIndex--; this.searchJump(); });
        this.button(this.searchBar, 'Next', () => { this.searchIndex++; this.searchJump(); });
        this.button(this.searchBar, 'Close search', () => this.closeSearch());
        this.split = this.contentEl.createDiv({ cls: 'cmm-composer-split' });
        this.drawer = this.split.createDiv({ cls: 'cmm-composer-unsorted', attr: { 'aria-label': 'Unsorted Ideas' } }); this.drawer.hidden = true;
        this.drawer.createEl('strong', { text: 'Unsorted Ideas' });
        this.drawer.createEl('p', { text: 'Capture first, then drag into the document.' });
        this.button(this.drawer, 'Add idea', () => this.addUnsorted());
        this.button(this.drawer, 'Move selection here', () => this.change(draft => parkNodes(draft, this.selected)));
        this.drawerList = this.drawer.createDiv({ cls: 'cmm-composer-unsorted-list' });
        this.registerDomEvent(this.drawerList, 'pointerdown', event => this.pointer(event));
        this.stage = this.split.createDiv({ cls: 'cmm-composer-stage', attr: { tabindex: '0', 'aria-label': 'Mind map. Enter adds a section, Tab adds a child.' } });
        this.svg = svgElement(this.contentEl.ownerDocument, 'svg', { class: 'cmm-organic-svg', width: '100%', height: '100%' });
        this.scene = svgElement(this.contentEl.ownerDocument, 'g'); this.svg.append(this.scene); this.stage.append(this.svg);
        const divider = this.split.createDiv({ cls: 'cmm-composer-divider', attr: { role: 'separator', tabindex: '0', 'aria-label': 'Resize body panel', 'aria-orientation': 'vertical' } });
        divider.onpointerdown = event => {
            event.preventDefault(); divider.setPointerCapture(event.pointerId);
            const resize = (e: PointerEvent) => { const bounds = this.split.getBoundingClientRect(); this.draft.panelWidth = Math.max(.2, Math.min(.7, (bounds.right - e.clientX) / bounds.width)); this.applyPanel(); };
            divider.onpointermove = resize; divider.onpointerup = () => { divider.onpointermove = null; this.remember(); };
            divider.onpointercancel = () => { divider.onpointermove = null; };
        };
        divider.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.draft.panelWidth = Math.max(.2, Math.min(.7, this.draft.panelWidth + (event.key === 'ArrowLeft' ? .05 : -.05))); this.applyPanel(); this.remember(); } };
        this.panel = this.split.createDiv({ cls: 'cmm-composer-body' });
        this.breadcrumb = this.panel.createDiv({ cls: 'cmm-composer-breadcrumb' });
        const typeRow = this.panel.createDiv({ cls: 'cmm-composer-type' });
        this.typeInput = typeRow.createEl('select', { attr: { 'aria-label': 'Node type' } });
        for (const [value, text] of [['heading', 'Heading'], ['idea', 'Idea'], ['todo', 'Todo']]) this.typeInput.createEl('option', { value, text });
        this.typeInput.onchange = () => this.changeType(this.typeInput.value as ComposerNode['type']);
        this.todoButton = this.button(typeRow, 'Mark complete', () => this.change(draft => { const node = this.node(undefined, draft); node.checked = !node.checked; }));
        this.body = this.panel.createEl('textarea', { attr: { 'aria-label': 'Direct section body', placeholder: 'Write paragraphs, lists, quotes or code here. Create section headings in the mind map.' } });
        this.body.oninput = () => {
            const id = this.draft.selection, text = this.body.value;
            this.change(draft => { this.node(id, draft).body = text; }, `body:${id}`, false);
        };
        this.status = this.contentEl.createDiv({ cls: 'cmm-composer-status' });
        this.register(this.store.subscribe(() => this.updateStatus()));
        this.registerDomEvent(this.contentEl, 'keydown', event => this.key(event));
        this.registerDomEvent(this.stage, 'dblclick', event => { const id = this.idAt(event.target); if (id) { this.select(id); this.rename(false); } });
        this.registerDomEvent(this.stage, 'pointerdown', event => { if ((event.target as Element).closest('svg')) this.pointer(event); });
        this.registerDomEvent(this.stage, 'wheel', event => {
            event.preventDefault(); const bounds = this.svg.getBoundingClientRect();
            this.viewport.zoom(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top); this.transform(); this.remember();
        }, { passive: false });
        this.render();
        this.register(() => { this.dragCleanup?.(); this.viewport.cancel(); this.renderer.close(); });
    }
    async onClose(): Promise<void> {
        this.finishName?.(); this.closed = true;
        if (this.initialized) { this.remember(); try { await this.store.flush(); } catch { this.recovery(); } }
    }
    private node(id = this.draft.selection, draft = this.draft): ComposerNode { return entries(draft, true).find(e => e.node.id === id)?.node ?? draft.root; }
    private button(parent: HTMLElement, text: string, callback: (event: MouseEvent) => void): HTMLButtonElement {
        const button = parent.createEl('button', { text }); button.onclick = callback; return button;
    }
    private change(edit: (draft: ComposerDraft) => void, group = '', render = true): boolean {
        const anchor = this.draft.selection;
        try { this.history.change(edit, group); if (render) { this.render(true, anchor); this.ensureVisible(); } this.remember(); return true; }
        catch (error) { new Notice((error as Error).message); return false; }
    }
    private remember(): void {
        if (!this.initialized) return;
        this.draft.viewport = this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600);
        this.store.put(this.draft); this.app.workspace.requestSaveLayout();
    }
    private updateStatus(): void {
        const stats = draftStatistics(this.draft);
        if (this.status) this.status.textContent = `${stats.sections} sections · ${stats.ideas} ideas · ${stats.completed}/${stats.todos} todos · ${stats.unsorted} unsorted · ${stats.words} words/字 · ${this.selected.length > 1 ? `${this.selected.length} selected · ` : ''}${this.store.status}${this.draft.root.children.length ? '' : ' · Start creating: Enter to add your first section'}`;
    }
    private render(anchor = false, anchorId = this.draft.selection): void {
        if (!this.scene) return;
        const old = this.result?.nodes.find(n => n.id === anchorId);
        const canvas = this.contentEl.ownerDocument.createElement('canvas'), context = canvas.getContext('2d');
        const matches = searchDraft(this.draft, this.query, this.searchScope);
        this.searchIndex = matches.length ? Math.min(this.searchIndex, matches.length - 1) : 0;
        const projection = composerProjection(this.draft, matches[this.searchIndex]);
        const next = this.engine.layout(projection.model, { style: this.draft.layout,
            collapsed: projection.collapsed,
            measureText: (text, size, weight) => { if (!context) return text.length * size * .6; context.font = `${weight} ${size}px sans-serif`; return context.measureText(text).width; } });
        const current = next.nodes.find(n => n.id === anchorId);
        if (anchor && old && current) this.viewport.pan((old.x - current.x) * this.viewport.scale, (old.y - current.y) * this.viewport.scale);
        this.result = next;
        this.renderer.render(this.scene, next, { navigate: (id, event) => this.select(id, event), toggle: id => this.change(draft => { const node = this.node(id, draft); node.collapsed = !node.collapsed; }),
            toggleLabel: collapsed => collapsed ? 'Expand branch' : 'Collapse branch', selected: this.draft.selection,
            matches: new Set(matches), currentMatch: matches[this.searchIndex],
            contextMenu: (id, event) => { if (!this.selected.includes(id)) this.select(id); if (id === this.draft.root.id) this.documentMenu(event); else this.nodeMenu(event); } });
        for (const group of Array.from(this.scene.querySelectorAll('[data-node-id]'))) {
            const id = group.getAttribute('data-node-id')!, node = this.node(id);
            group.classList.toggle('is-multiselected', this.selected.includes(id)); group.classList.add(`is-${node.type}`);
        }
        this.transform(); this.syncBody(); this.applyPanel(); this.updateStatus();
        this.renderDrawer(); this.focusButton.textContent = this.draft.focusNode ? 'Show overview' : 'Focus';
        this.searchLabel.textContent = matches.length ? `${this.searchIndex + 1} / ${matches.length}` : this.query ? 'No results' : '';
        const selects = this.contentEl.querySelectorAll('select');
        if (selects[0]) selects[0].value = this.draft.layout; if (selects[1]) selects[1].value = this.draft.panel;
    }
    private transform(): void { this.scene.setAttribute('transform', `translate(${this.viewport.offset.x} ${this.viewport.offset.y}) scale(${this.viewport.scale})`); }
    private fit(): void { if (this.result) { this.viewport.fit(this.result.bounds, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform(); this.remember(); } }
    private zoom(factor: number): void { this.viewport.zoom(factor, this.svg.clientWidth / 2, this.svg.clientHeight / 2); this.transform(); this.remember(); }
    private select(id: string, event?: MouseEvent | KeyboardEvent): void {
        this.finishName?.(); const previous = this.selected;
        if (event?.shiftKey && this.selectionAnchor) {
            const visible = this.visibleOrder(), a = visible.indexOf(this.selectionAnchor), b = visible.indexOf(id);
            this.draft.selections = a >= 0 && b >= 0 ? visible.slice(Math.min(a, b), Math.max(a, b) + 1).filter(key => key !== this.draft.root.id) : [id];
        } else if (event?.ctrlKey || event?.metaKey) {
            this.draft.selections = previous.includes(id) ? previous.filter(key => key !== id) : [...previous.filter(key => key !== this.draft.root.id), id];
            this.selectionAnchor = id;
        } else { this.draft.selections = [id]; this.selectionAnchor = id; }
        this.draft.selection = this.draft.selections.includes(id) ? id : this.draft.selections[0] ?? this.draft.root.id;
        this.autoPanel = true; this.render(); this.ensureVisible(); this.stage.focus(); this.remember();
    }
    private syncBody(): void {
        const node = this.node(); if (this.body.value !== node.body) this.body.value = node.body;
        const all = entries(this.draft, true), path: ComposerNode[] = []; let current: ComposerNode | undefined = node;
        while (current) { path.unshift(current); current = all.find(e => e.node.id === current!.id)?.parent; }
        this.breadcrumb.empty();
        for (const item of path) { this.button(this.breadcrumb, item.title || 'Untitled', () => this.select(item.id)); }
        this.body.setAttribute('aria-label', node === this.draft.root ? 'Document introduction' : `${node.title}: direct body`);
        this.typeInput.value = node.type; this.typeInput.disabled = this.selected.includes(this.draft.root.id);
        this.todoButton.hidden = node.type !== 'todo'; this.todoButton.textContent = node.checked ? 'Mark incomplete' : 'Mark complete';
    }
    private applyPanel(): void {
        const visible = this.draft.panel === 'show' || (this.draft.panel === 'auto' && this.autoPanel);
        this.split.classList.toggle('has-body', visible); this.panel.style.width = `${this.draft.panelWidth * 100}%`;
    }
    private visibleOrder(): string[] {
        const visible = new Set(this.result?.nodes.map(n => n.id));
        return entries(this.draft, true).filter(e => visible.has(e.node.id) || (e.unsorted && this.drawerOpen)).map(e => e.node.id);
    }
    openSearch(): void { this.finishName?.(); this.searchBar.hidden = false; this.searchInput.focus(); this.searchInput.select(); }
    private closeSearch(): void {
        this.query = ''; this.searchInput.value = ''; this.searchBar.hidden = true;
        if (this.draft.focusNode) { this.draft.selection = this.draft.focusNode; this.draft.selections = [this.draft.focusNode]; }
        this.render(); this.ensureVisible(); this.stage.focus(); this.remember();
    }
    private searchJump(): void {
        const matches = searchDraft(this.draft, this.query, this.searchScope);
        this.searchIndex = matches.length ? (this.searchIndex + matches.length) % matches.length : 0;
        if (matches.length) {
            const id = matches[this.searchIndex]; this.draft.selection = id; this.draft.selections = [id];
            if (entries(this.draft, true).find(e => e.node.id === id)?.unsorted) this.drawerOpen = true;
        }
        this.render(); this.ensureVisible(); this.searchInput.focus(); this.remember();
    }
    private focusBranch(id?: string): void {
        this.finishName?.();
        const next = id ?? (this.draft.focusNode ? null : this.draft.selection);
        if (next && !entries(this.draft).some(e => e.node.id === next)) { new Notice('Move this idea into the document before focusing its branch.'); return; }
        this.draft.focusNode = next === this.draft.root.id ? null : next;
        this.query = ''; this.searchInput.value = ''; this.render(); this.fit(); this.remember();
    }
    private renderDrawer(): void {
        this.drawer.hidden = !this.drawerOpen; this.drawerList.empty();
        if (!this.drawerOpen) return;
        const matches = searchDraft(this.draft, this.query, this.searchScope);
        for (const { node, depth } of entries(this.draft, true).filter(e => e.unsorted)) {
            const row = this.drawerList.createDiv({ cls: 'cmm-composer-unsorted-node', attr: { 'data-node-id': node.id } });
            row.style.marginLeft = `${(depth - 1) * 12}px`;
            row.classList.toggle('is-selected', this.selected.includes(node.id)); row.classList.toggle('is-match', matches.includes(node.id));
            const label = this.button(row, `${node.type === 'idea' ? '? ' : node.type === 'todo' ? node.checked ? '☑ ' : '☐ ' : ''}${node.title || 'New idea'}`, event => this.select(node.id, event));
            label.ondblclick = () => { this.select(node.id); this.rename(false); };
            row.oncontextmenu = event => { event.preventDefault(); if (!this.selected.includes(node.id)) this.select(node.id); this.nodeMenu(event); };
        }
        if (!this.draft.unsorted?.length) this.drawerList.createEl('p', { text: 'No unsorted ideas yet.' });
    }
    private prompt(title: string, value: string, accept: (value: string) => boolean | void): void {
        const modal = new Modal(this.app); modal.titleEl.setText(title);
        const input = modal.contentEl.createEl('input', { value, attr: { 'aria-label': title } });
        const submit = () => { if (input.value.trim() && accept(input.value.trim()) !== false) { modal.close(); this.stage.focus(); } };
        this.button(modal.contentEl, 'Cancel', () => modal.close()); this.button(modal.contentEl, 'Confirm', submit);
        input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); } };
        modal.open(); input.focus(); input.select();
    }
    private addUnsorted(): void {
        this.prompt('New unsorted idea', '', title => this.change(draft => { const node = newNode(title, 'idea'); (draft.unsorted ??= []).push(node); draft.selection = node.id; draft.selections = [node.id]; }));
    }
    private changeType(type: ComposerNode['type']): void {
        const ids = this.selected.filter(id => id !== this.draft.root.id);
        this.change(draft => { for (const id of ids) this.node(id, draft).type = type; });
    }
    private groupSelection(): void {
        const ids = this.selected;
        this.prompt('Create parent from selection', 'New group', title => this.change(draft => { createParent(draft, ids, title); }));
    }
    private foldBranch(action: 'collapse' | 'expand' | 'one' | 'level', level = 1): void {
        const ids = this.selected;
        this.change(draft => {
            const roots = ids.includes(draft.root.id) ? [draft.root] : selectedRoots(draft, ids).map(e => e.node);
            for (const node of roots) {
                const visit = (current: ComposerNode, depth: number) => {
                    current.collapsed = action === 'collapse' || (action === 'one' && depth >= 1) || (action === 'level' && depth >= level);
                    current.children.forEach(child => visit(child, depth + 1));
                };
                visit(node, 0);
            }
        });
    }
    private documentProperties(): void {
        const modal = new Modal(this.app); modal.titleEl.setText('Document properties');
        modal.contentEl.createEl('p', { text: 'YAML frontmatter, without --- delimiters. This is saved with the draft and placed before the introduction.' });
        const input = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery', attr: { 'aria-label': 'Frontmatter YAML', placeholder: 'tags:\n  - research\nstatus: draft' } }); input.value = this.draft.frontmatter ?? '';
        const error = modal.contentEl.createEl('p', { attr: { role: 'alert' } });
        this.button(modal.contentEl, 'Cancel', () => modal.close());
        this.button(modal.contentEl, 'Save properties', () => {
            try { validateProperties(input.value); if (this.change(draft => { draft.frontmatter = input.value; })) modal.close(); }
            catch (failure) { error.textContent = (failure as Error).message; }
        }); modal.open();
    }
    private copyOutline(): void {
        const text = outlineMarkdown(this.draft);
        const clipboard = this.contentEl.ownerDocument.defaultView!.navigator.clipboard;
        void (clipboard ? clipboard.writeText(text) : Promise.reject(new Error('Clipboard unavailable'))).then(() => new Notice('Outline copied.')).catch(() => {
            const modal = new Modal(this.app); modal.titleEl.setText('Copy outline');
            const input = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery' }); input.value = text; input.readOnly = true; modal.open(); input.focus(); input.select();
        });
    }
    renameDocument(title: string): void { this.finishName?.(); this.change(draft => { draft.root.title = title; }); }
    private async openDraft(draft: ComposerDraft): Promise<void> {
        try { this.store.put(draft); await this.store.flush(); const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: COMPOSER_VIEW, active: true, state: { draftId: draft.draftId } });
        } catch (error) { new Notice((error as Error).message); }
    }
    private ensureVisible(): void {
        const node = this.result?.nodes.find(n => n.id === this.draft.selection); if (!node) return;
        const x = node.x * this.viewport.scale + this.viewport.offset.x, y = node.y * this.viewport.scale + this.viewport.offset.y;
        const width = node.width * this.viewport.scale, height = node.height * this.viewport.scale;
        const dx = x < 24 ? 24 - x : x + width > this.svg.clientWidth - 24 ? this.svg.clientWidth - 24 - x - width : 0;
        const dy = y < 24 ? 24 - y : y + height > this.svg.clientHeight - 24 ? this.svg.clientHeight - 24 - y - height : 0;
        this.viewport.pan(dx, dy); this.transform();
    }
    private add(child: boolean): void {
        this.finishName?.(); const id = this.draft.selection, node = newNode('');
        if (entries(this.draft, true).find(e => e.node.id === id)?.unsorted) {
            this.prompt('New unsorted idea', '', title => this.change(draft => {
                const next = newNode(title, 'idea'), source = this.node(id, draft);
                const siblings = child ? source.children : siblingsOf(draft, id); siblings.splice(child ? siblings.length : siblings.indexOf(source) + 1, 0, next);
                draft.selection = next.id; draft.selections = [next.id];
            })); return;
        }
        this.history.beginEdit();
        if (!this.change(draft => {
            const source = entries(draft, true).find(e => e.node.id === id)!;
            const asChild = child || source.node === draft.root;
            const siblings = asChild ? source.node.children : siblingsOf(draft, id);
            siblings.splice(asChild ? siblings.length : siblings.indexOf(source.node) + 1, 0, node);
            if (source.unsorted) node.type = 'idea';
            if (asChild) source.node.collapsed = false;
            draft.selection = node.id; draft.selections = [node.id];
        })) { this.history.endEdit(true); return; }
        if (!this.result?.nodes.some(n => n.id === node.id)) {
            this.draft.focusNode = null; this.query = ''; this.searchInput.value = ''; this.render();
        }
        this.ensureVisible(); this.rename(true);
    }
    private rename(fresh: boolean): void {
        this.finishName?.(); const id = this.draft.selection, original = this.node().title;
        const geometry = this.result?.nodes.find(n => n.id === id);
        if (!geometry) { this.prompt('Rename idea', original, title => this.change(draft => { this.node(id, draft).title = title; })); return; }
        if (!fresh) this.history.beginEdit();
        const input = this.stage.createEl('input', { cls: 'cmm-composer-title-input', value: original, attr: { 'aria-label': fresh ? 'New section title' : 'Rename node' } });
        this.nameInput = input;
        input.style.left = `${geometry.x * this.viewport.scale + this.viewport.offset.x}px`;
        input.style.top = `${geometry.y * this.viewport.scale + this.viewport.offset.y}px`;
        input.style.width = `${Math.max(180, geometry.width * this.viewport.scale)}px`;
        let finished = false;
        this.finishName = (cancel = false) => {
            if (finished) return; finished = true; this.finishName = undefined; this.nameInput = undefined;
            const title = input.value.trim(); input.remove();
            if (!cancel && title) this.change(draft => { this.node(id, draft).title = title; }, `title:${id}`, false);
            this.history.endEdit(cancel || !title); this.render(true); this.remember();
        };
        input.oninput = () => { this.change(draft => { this.node(id, draft).title = input.value; }, `title:${id}`, false); };
        input.onblur = () => this.finishName?.();
        input.onkeydown = event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (!['Enter', 'Tab', 'Escape'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); const value = input.value.trim();
            this.finishName?.(event.key === 'Escape'); this.stage.focus();
            if (event.key === 'Tab' && event.shiftKey) this.structure('promote');
            else if (value && (event.key === 'Tab' || (event.key === 'Enter' && fresh))) this.add(event.key === 'Tab');
        };
        input.focus(); input.select();
    }
    private structure(action: 'promote' | 'demote' | 'up' | 'down'): void {
        const ids = this.selected;
        this.change(draft => organizeSelection(draft, ids, action));
        this.ensureVisible();
    }
    private deleteNode(): void {
        const ids = this.selected.filter(id => id !== this.draft.root.id); if (!ids.length) return;
        const remove = (keep: boolean) => this.change(draft => deleteSelection(draft, ids, keep));
        if (ids.length === 1 && !this.node(ids[0]).children.length) { remove(false); return; }
        const modal = new Modal(this.app); modal.titleEl.setText(ids.length > 1 ? `Delete ${ids.length} selected nodes?` : `Delete “${this.node().title}”?`);
        this.button(modal.contentEl, 'Delete this branch', () => { remove(false); modal.close(); });
        this.button(modal.contentEl, 'Delete node but keep children', () => { remove(true); modal.close(); });
        this.button(modal.contentEl, 'Cancel', () => modal.close()); modal.open();
    }
    private key(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        const target = event.target as HTMLElement;
        if (target === this.nameInput) return;
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === 'f' && target !== this.body) { event.preventDefault(); this.openSearch(); return; }
        if (mod && event.key === 'Enter') { event.preventDefault(); this.autoPanel = true; this.draft.panel = this.draft.panel === 'hide' ? 'auto' : this.draft.panel; this.applyPanel(); this.body.focus(); return; }
        if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) this.history.redo(); else this.history.undo(); this.render(true); this.ensureVisible(); this.remember(); return; }
        if (target.closest('textarea, input, select, button')) { if (event.key === 'Escape' && target === this.body) { event.preventDefault(); this.stage.focus(); } return; }
        let handled = true;
        if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) this.structure(({ ArrowLeft: 'promote', ArrowRight: 'demote', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowLeft']);
        else if (event.key === 'Enter') this.add(false);
        else if (event.key === 'Tab') event.shiftKey ? this.structure('promote') : this.add(true);
        else if (event.key === 'F2') this.rename(false);
        else if (event.key === 'Delete' || event.key === 'Backspace') this.deleteNode();
        else if (event.key === '0') this.fit();
        else if (event.key === '+' || event.key === '=') this.zoom(1.18);
        else if (event.key === '-') this.zoom(.85);
        else if (event.key === 'Escape' && this.draft.focusNode) this.focusBranch();
        else if (event.key.startsWith('Arrow')) {
            const all = entries(this.draft, true), current = all.find(e => e.node.id === this.draft.selection)!;
            const visible = this.visibleOrder(), ordered = all.filter(e => visible.includes(e.node.id)); const index = ordered.indexOf(current);
            const next = event.key === 'ArrowLeft' ? current.parent : event.key === 'ArrowRight' ? current.node.children[0] : ordered[index + (event.key === 'ArrowDown' ? 1 : -1)]?.node;
            if (next && visible.includes(next.id)) { this.select(next.id); this.ensureVisible(); }
        } else handled = false;
        if (handled) { event.preventDefault(); event.stopPropagation(); }
    }
    private idAt(target: EventTarget | null): string | undefined { return (target as Element | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? undefined; }
    private pointer(event: PointerEvent): void {
        if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
        const id = this.idAt(event.target), start = { x: event.clientX, y: event.clientY }; let last = start, moved = false;
        const ids = id && this.selected.includes(id) ? this.selected : id ? [id] : [];
        const apply = (draft: ComposerDraft, target: string, position: DropPosition) => {
            if (target === '@unsorted') { if (ids.includes(draft.root.id)) throw new Error('The document root cannot be moved.'); parkNodes(draft, ids); }
            else moveNodes(draft, ids, target, position);
        };
        let drop: { target: string; position: DropPosition; valid: boolean } | undefined;
        const preview = this.stage.createDiv({ cls: 'cmm-composer-drop' }); preview.hidden = true;
        const win = this.contentEl.ownerDocument.defaultView!;
        const move = (e: PointerEvent) => {
            if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
            moved = true;
            if (!id) this.viewport.pan(e.clientX - last.x, e.clientY - last.y);
            else {
                const element = this.contentEl.ownerDocument.elementFromPoint(e.clientX, e.clientY), target = this.idAt(element) ?? (element?.closest('.cmm-composer-unsorted') ? '@unsorted' : undefined);
                drop = undefined; preview.hidden = true;
                if (target) {
                    const group = element!.closest('[data-node-id]') ?? this.drawer, bounds = group.getBoundingClientRect();
                    const fraction = (e.clientY - bounds.top) / bounds.height;
                    const position: DropPosition = fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'child';
                    let valid = true, reason = ''; try { apply(clone(this.draft), target, position); } catch (error) { valid = false; reason = (error as Error).message; }
                    drop = { target, position, valid }; preview.hidden = false;
                    preview.textContent = valid ? target === '@unsorted' ? 'Move to Unsorted Ideas' : `Before ${position === 'before' ? '◀' : ''}\nMake child ${position === 'child' ? '◀' : ''}\nAfter ${position === 'after' ? '◀' : ''}` : reason;
                    preview.classList.toggle('is-invalid', !valid);
                    const stage = this.stage.getBoundingClientRect(); preview.style.left = `${Math.max(0, Math.min(stage.width - 170, bounds.right - stage.left + 10))}px`; preview.style.top = `${Math.max(0, bounds.top - stage.top)}px`;
                }
            }
            last = { x: e.clientX, y: e.clientY }; this.transform();
        };
        const cleanup = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', cancel); preview.remove(); this.dragCleanup = undefined; };
        const cancel = () => cleanup();
        const end = () => {
            cleanup();
            if (moved && id && drop?.valid) { const destination = drop; this.change(draft => { apply(draft, destination.target, destination.position); draft.selection = id; draft.selections = ids; }); this.ensureVisible(); }
            if (!id && !moved) { this.autoPanel = false; this.applyPanel(); this.stage.focus(); }
            if (moved) { const suppress = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); }; this.contentEl.addEventListener('click', suppress, { capture: true, once: true }); setTimeout(() => this.contentEl.removeEventListener('click', suppress, true), 0); }
            this.remember();
        };
        this.dragCleanup?.(); this.dragCleanup = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', cancel);
    }
    private nodeMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle('Rename').onClick(() => this.rename(false)));
        menu.addItem(item => item.setTitle('Edit body').onClick(() => { this.autoPanel = true; this.draft.panel = 'auto'; this.applyPanel(); this.body.focus(); }));
        const submenu = (label: string, build: (menu: Menu) => void) => menu.addItem(item => {
            item.setTitle(label); const supported = item as typeof item & { setSubmenu?: () => Menu };
            if (supported.setSubmenu) build(supported.setSubmenu()); else { item.setDisabled(true); build(menu); }
        });
        submenu('Create', menu => {
            menu.addItem(item => item.setTitle('Add sibling').onClick(() => this.add(false)));
            menu.addItem(item => item.setTitle('Add child').onClick(() => this.add(true)));
            menu.addItem(item => item.setTitle('Create parent from selection').onClick(() => this.groupSelection()));
        });
        submenu('Structure', menu => {
            for (const action of ['promote', 'demote', 'up', 'down'] as const) menu.addItem(item => item.setTitle(({ promote: 'Promote', demote: 'Demote', up: 'Move up', down: 'Move down' })[action]).onClick(() => this.structure(action)));
            menu.addItem(item => item.setTitle('Move to Unsorted Ideas').onClick(() => { const ids = this.selected; this.drawerOpen = true; this.change(draft => parkNodes(draft, ids)); }));
            menu.addItem(item => item.setTitle('Move to document root').onClick(() => { const ids = this.selected; this.change(draft => moveNodes(draft, ids, draft.root.id, 'child')); }));
        });
        submenu('View', menu => {
            menu.addItem(item => item.setTitle('Focus branch').onClick(() => this.focusBranch(this.draft.selection)));
            menu.addItem(item => item.setTitle('Show overview').onClick(() => this.focusBranch(this.draft.root.id)));
            for (const [action, title] of [['one', 'Expand one level'], ['expand', 'Expand branch'], ['collapse', 'Collapse branch']] as const)
                menu.addItem(item => item.setTitle(title).onClick(() => this.foldBranch(action)));
            menu.addItem(item => item.setTitle('Show to level…').onClick(() => this.prompt('Show branch to level (1–6)', '2', value => {
                const level = Number(value); if (!Number.isInteger(level) || level < 1 || level > 6) { new Notice('Choose a level from 1 to 6.'); return false; } this.foldBranch('level', level);
            })));
        });
        submenu('Node type', menu => {
            for (const type of ['heading', 'idea', 'todo'] as const) menu.addItem(item => item.setTitle(type === 'heading' ? 'Heading' : type === 'idea' ? 'Idea' : 'Todo').setChecked(this.node().type === type).onClick(() => this.changeType(type)));
        });
        menu.addSeparator(); menu.addItem(item => item.setTitle('Delete').onClick(() => this.deleteNode())); menu.showAtMouseEvent(event);
    }
    private documentMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle('Rename document').onClick(() => { this.select(this.draft.root.id); this.rename(false); }));
        menu.addItem(item => item.setTitle('Edit introduction').onClick(() => { this.select(this.draft.root.id); this.draft.panel = 'auto'; this.applyPanel(); this.body.focus(); }));
        menu.addItem(item => item.setTitle('Add top-level section').onClick(() => { this.select(this.draft.root.id); this.add(true); }));
        menu.addItem(item => item.setTitle('Use root as H1').setChecked(this.draft.rootAsHeading).onClick(() => this.change(draft => { draft.rootAsHeading = !draft.rootAsHeading; })));
        menu.addItem(item => item.setTitle('Document properties').onClick(() => this.documentProperties()));
        menu.addItem(item => item.setTitle('New from template').onClick(() => showTemplates(this.app, draft => { void this.openDraft({ ...draft, ...this.store.preferences }); }, this.draft.targetFolder)));
        menu.addItem(item => item.setTitle('Duplicate draft').onClick(() => { this.finishName?.(); void this.openDraft(duplicateDraft(this.draft)); }));
        menu.addItem(item => item.setTitle('Copy outline').onClick(() => this.copyOutline()));
        menu.addItem(item => item.setTitle('Retry draft save').onClick(() => { void this.store.flush().catch(() => this.recovery()); }));
        menu.addItem(item => item.setTitle('Copy recovery data').onClick(() => this.recovery()));
        menu.addItem(item => item.setTitle('Create Markdown Note').onClick(() => this.createNote()));
        menu.addSeparator(); menu.addItem(item => item.setTitle('Discard draft').onClick(() => {
            const modal = new Modal(this.app); modal.titleEl.setText(`Discard “${this.draft.root.title}”?`);
            modal.contentEl.createEl('p', { text: 'This draft has not been converted to a Markdown note.' });
            this.button(modal.contentEl, 'Cancel', () => modal.close());
            this.button(modal.contentEl, 'Discard', () => { void (async () => { try { this.finishName?.(); await this.store.remove(this.draft.draftId); this.initialized = false; modal.close(); this.leaf.detach(); } catch { this.recovery(); } })(); }); modal.open();
        })); menu.showAtMouseEvent(event);
    }
    private recovery(): void {
        const modal = new Modal(this.app); modal.titleEl.setText('Draft recovery');
        modal.contentEl.createEl('p', { text: 'Draft storage could not be confirmed. Copy this recovery data before closing Obsidian, or retry saving.' });
        const text = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery' }); text.value = JSON.stringify(this.draft, null, 2); text.readOnly = true;
        this.button(modal.contentEl, 'Select recovery data', () => { text.focus(); text.select(); });
        this.button(modal.contentEl, 'Retry save', () => { this.store.put(this.draft); void this.store.flush().then(() => modal.close()).catch(() => {}); }); modal.open();
    }
    private createNote(): void {
        this.finishName?.(); if (this.creating) return;
        const modal = new Modal(this.app); modal.titleEl.setText('Create Markdown Note');
        const label = (text: string) => modal.contentEl.createEl('label', { cls: 'cmm-composer-field', text });
        const name = label('Name').createEl('input', { value: this.draft.root.title });
        const location = label('Location (existing vault folder)').createEl('input', { value: this.draft.targetFolder });
        const root = label('Root behavior').createEl('select'); root.createEl('option', { value: 'no', text: 'Document name only' }); root.createEl('option', { value: 'yes', text: 'Use root as H1' }); root.value = this.draft.rootAsHeading ? 'yes' : 'no';
        const stats = draftStatistics(this.draft);
        const ideasLabel = label(`This draft contains ${stats.ideas} idea nodes. Export ideas as`);
        const ideas = ideasLabel.createEl('select', { attr: { 'aria-label': 'Idea export policy' } });
        for (const [value, text] of [['', 'Choose…'], ['headings', 'Convert to headings'], ['bullets', 'Convert to bullet items'], ['exclude', 'Exclude idea branches'], ['review', 'Review individually']]) ideas.createEl('option', { value, text });
        ideasLabel.hidden = stats.ideas === 0;
        ideas.onchange = () => { if (ideas.value === 'review') { modal.close(); this.reviewIdeas(); } else refreshPreview(); };
        const unsortedLabel = label(`${stats.unsorted} nodes in Unsorted Ideas`);
        const unsorted = unsortedLabel.createEl('select', { attr: { 'aria-label': 'Unsorted export policy' } });
        for (const [value, text] of [['', 'Choose…'], ['append', 'Append to document'], ['exclude', 'Exclude and keep draft']]) unsorted.createEl('option', { value, text });
        unsortedLabel.hidden = !stats.unsorted;
        if (stats.ideas || stats.unsorted) modal.contentEl.createEl('p', { text: 'Excluded branches remain in a saved draft after creation. Bullet and Todo branches become lists, including their descendants and bodies.' });
        const empty = label('Create an empty Markdown note if there are no sections'); const confirmEmpty = empty.createEl('input', { type: 'checkbox' }); empty.hidden = this.draft.root.children.length > 0;
        const error = modal.contentEl.createEl('p', { attr: { role: 'alert' } });
        const prepare = () => {
            const snapshot = clone(this.draft); snapshot.rootAsHeading = root.value === 'yes'; validateProperties(snapshot.frontmatter ?? '');
            const options: ComposerExportOptions = { ideas: ideas.value && ideas.value !== 'review' ? ideas.value as ComposerExportOptions['ideas'] : undefined,
                unsorted: unsorted.value ? unsorted.value as ComposerExportOptions['unsorted'] : undefined };
            return { snapshot, generated: exportMarkdown(snapshot, options) };
        };
        const preview = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-markdown-preview', attr: { 'aria-label': 'Markdown preview' } }); preview.readOnly = true; preview.hidden = true;
        const refreshPreview = () => { if (preview.hidden) return; try { preview.value = prepare().generated.text; error.textContent = ''; } catch (failure) { preview.value = ''; error.textContent = (failure as Error).message; } };
        this.button(modal.contentEl, 'Preview Markdown', () => { preview.hidden = !preview.hidden; refreshPreview(); });
        root.onchange = refreshPreview; unsorted.onchange = refreshPreview;
        const existing = this.button(modal.contentEl, 'Open existing note', () => { try { const file = this.app.vault.getAbstractFileByPath(notePath(name.value, location.value)); if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file); } catch {} }); existing.hidden = true;
        this.button(modal.contentEl, 'Cancel', () => modal.close());
        const create = this.button(modal.contentEl, 'Create', () => { void (async () => {
            if (this.creating || this.closed) return; this.creating = true; create.disabled = true; error.textContent = ''; existing.hidden = true;
            try {
                const { snapshot, generated } = prepare();
                if (!generated.text.trim() && !confirmEmpty.checked) { empty.hidden = false; throw new Error('This mind map has no document sections. Confirm creation of an empty note.'); }
                const path = notePath(name.value, location.value), folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
                if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new Error('Choose an existing vault folder.');
                const prior = this.app.vault.getAbstractFileByPath(path);
                if (prior && !(snapshot.createdPath === path && prior instanceof TFile && await this.app.vault.read(prior) === generated.text)) {
                    existing.hidden = !(prior instanceof TFile); throw new Error('A note with this name already exists. Choose another name or open the existing note.');
                }
                this.store.put(snapshot); await this.store.flush();
                if (!prior) await this.app.vault.create(path, generated.text);
                snapshot.createdPath = path; this.history.draft = snapshot; this.store.put(snapshot); await this.store.flush();
                const viewport = this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600);
                let selectedEntry = entries(snapshot, true).find(e => e.node.id === snapshot.selection);
                while (selectedEntry && !generated.offsets.has(selectedEntry.node.id)) selectedEntry = selectedEntry.parent ? entries(snapshot, true).find(e => e.node.id === selectedEntry!.parent!.id) : undefined;
                const writingState = { fingerprint: sourceFingerprint(generated.text), selected: selectedEntry ? generated.offsets.get(selectedEntry.node.id)! : -1,
                    collapsed: entries(snapshot).filter(e => e.node.collapsed && generated.offsets.has(e.node.id)).map(e => generated.offsets.get(e.node.id)!), focus: null, styles: [], viewport };
                await this.leaf.setViewState({ type: ORGANIC_VIEW, active: true, state: { file: path, writing: true, viewport, writingState, splitRatio: 1 - snapshot.panelWidth, editorVisible: snapshot.panel !== 'hide', composerLayout: snapshot.layout } });
                if (!(this.leaf.view instanceof OrganicMindMapView) || !this.leaf.view.isWriting)
                    throw new Error(`Created ${path}, but Organic Edit could not be initialized. Your draft is retained in Restore Composer Draft.`);
                if (!generated.omitted) await this.store.remove(snapshot.draftId);
                modal.close(); new Notice(`Created ${path}${generated.omitted ? ' · Draft retained with excluded ideas.' : ''}`);
            } catch (failure) { error.textContent = (failure as Error).message; }
            finally { this.creating = false; create.disabled = false; }
        })(); }); create.addClass('mod-cta'); modal.open(); if (this.draft.root.title === 'Untitled') { name.focus(); name.select(); }
    }
    private reviewIdeas(): void {
        const modal = new Modal(this.app); modal.titleEl.setText('Review idea nodes');
        modal.contentEl.createEl('p', { text: 'Convert individual ideas to headings or todos, or open a node to edit it. Then create the note again.' });
        for (const { node, unsorted } of entries(this.draft, true).filter(e => e.node.type === 'idea')) {
            const row = modal.contentEl.createDiv({ cls: 'cmm-composer-draft-row' });
            this.button(row, `${unsorted ? 'Unsorted / ' : ''}${node.title}`, () => { modal.close(); if (unsorted) this.drawerOpen = true; this.select(node.id); this.ensureVisible(); });
            const type = row.createEl('select', { attr: { 'aria-label': `Type for ${node.title}` } });
            for (const value of ['idea', 'heading', 'todo']) type.createEl('option', { value, text: value });
            type.onchange = () => this.change(draft => { this.node(node.id, draft).type = type.value as ComposerNode['type']; });
        }
        this.button(modal.contentEl, 'Back to Create Note', () => { modal.close(); this.createNote(); }); modal.open();
    }
}

function validateProperties(value: string): void {
    if (!value.trim()) return;
    if (/^(---|\.\.\.)\s*$/m.test(value)) throw new Error('Enter YAML without --- delimiters.');
    const properties: unknown = parseYaml(value);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Document properties must be a YAML mapping, such as tags: [research].');
}

export function showTemplates(app: App, accept: (draft: ComposerDraft) => void, folder = ''): void {
    const modal = new Modal(app); modal.titleEl.setText('New Composer from template');
    for (const [key, template] of Object.entries(COMPOSER_TEMPLATES)) {
        const button = modal.contentEl.createEl('button', { text: key === 'blank' ? 'Blank' : template.title, cls: 'cmm-composer-template' });
        button.onclick = () => { accept(fromTemplate(key, folder)); modal.close(); };
    }
    modal.open();
}

export function showDrafts(app: App, store: ComposerStore, open: (id: string) => Promise<void>): void {
    const modal = new Modal(app); modal.titleEl.setText('Restore Composer Draft');
    const drafts = Object.values(store.data).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!drafts.length) modal.contentEl.createEl('p', { text: 'No unfinished drafts.' });
    for (const draft of drafts) {
        const row = modal.contentEl.createDiv({ cls: 'cmm-composer-draft-row' });
        const button = row.createEl('button', { text: draft.root.title || 'Untitled' });
        button.onclick = () => { void open(draft.draftId); modal.close(); };
        row.createEl('small', { text: new Date(draft.updatedAt).toLocaleString() });
        const rename = row.createEl('button', { text: 'Rename' });
        rename.onclick = () => {
            const editor = new Modal(app); editor.titleEl.setText('Rename draft');
            const title = editor.contentEl.createEl('input', { value: store.data[draft.draftId]?.root.title ?? draft.root.title, attr: { 'aria-label': 'Draft name' } });
            const save = editor.contentEl.createEl('button', { text: 'Save' });
            save.onclick = () => { void (async () => {
                if (!title.value.trim()) return;
                const active = app.workspace.getLeavesOfType(COMPOSER_VIEW).find(leaf => leaf.view.getState().draftId === draft.draftId)?.view as ComposerView | undefined;
                if (active) active.renameDocument(title.value.trim());
                else { const current = clone(store.data[draft.draftId]); current.root.title = title.value.trim(); current.updatedAt = Date.now(); store.put(current); }
                try { await store.flush(); button.textContent = title.value.trim(); editor.close(); } catch (error) { new Notice(String(error)); }
            })(); }; editor.open(); title.focus(); title.select();
        };
        const duplicate = row.createEl('button', { text: 'Duplicate' });
        duplicate.onclick = () => { void (async () => {
            try { const copy = duplicateDraft(store.data[draft.draftId]); store.put(copy); await store.flush(); await open(copy.draftId); modal.close(); }
            catch (error) { new Notice(String(error)); }
        })(); };
        const remove = row.createEl('button', { text: 'Delete' });
        remove.onclick = () => {
            if (app.workspace.getLeavesOfType(COMPOSER_VIEW).some(leaf => leaf.view.getState().draftId === draft.draftId)) { new Notice('Close this draft tab first, or use Discard draft in its document menu.'); return; }
            const confirm = new Modal(app); confirm.titleEl.setText(`Discard “${store.data[draft.draftId].root.title}”?`);
            confirm.contentEl.createEl('p', { text: 'This removes the saved draft, including unsorted ideas.' });
            const cancel = confirm.contentEl.createEl('button', { text: 'Cancel' }); cancel.onclick = () => confirm.close();
            const discard = confirm.contentEl.createEl('button', { text: 'Discard' });
            discard.onclick = () => { void store.remove(draft.draftId).then(() => { row.remove(); confirm.close(); }).catch(error => new Notice(String(error))); }; confirm.open();
        };
    }
    const recovery = modal.contentEl.createEl('details'); recovery.createEl('summary', { text: 'Restore from recovery data' });
    const input = recovery.createEl('textarea', { cls: 'cmm-composer-recovery', attr: { 'aria-label': 'Paste draft recovery JSON' } });
    const restore = recovery.createEl('button', { text: 'Restore as a new draft' });
    restore.onclick = () => { void (async () => {
        try { const draft = normalizeDraft(JSON.parse(input.value)); draft.draftId = newDraft().draftId; draft.updatedAt = Date.now(); delete draft.createdPath;
            store.put(draft); await store.flush(); await open(draft.draftId); modal.close();
        } catch (error) { new Notice((error as Error).message); }
    })(); };
    modal.open();
}
