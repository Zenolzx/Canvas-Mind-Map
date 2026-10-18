import { ct } from '../i18n';
import { App, ItemView, Menu, Modal, Notice, parseYaml, Platform, Scope, setIcon, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { OrganicLayoutEngine, OrganicLayoutResult } from '../organic/OrganicLayoutEngine';
import { DEFAULT_SURFACE, OrganicMindMapRenderer, svgElement } from '../organic/OrganicMindMapRenderer';
import { OrganicViewportController } from '../organic/OrganicViewportController';
import { ORGANIC_VIEW, OrganicMindMapView } from '../organic/OrganicMindMapView';
import { sourceFingerprint } from '../organic/OrganicViewState';
import { clone, ComposerDraft, ComposerExportOptions, ComposerHistory, ComposerNode, createParent, entries, exportMarkdown, newDraft, newNode, normalizeDraft, notePath, selectedRoots, siblingsOf } from './ComposerModel';
import { ComposerStore } from './ComposerStore';
import { COMPOSER_TEMPLATES, composerProjection, deleteSelection, draftStatistics, duplicateDraft, fromTemplate, organizeSelection, outlineMarkdown, SearchScope, searchDraft } from './ComposerTools';
import { DropHit, DropTarget, hitDrop, plainPreview, transferNodes } from './ComposerInteraction';
import { emptySketch, FreeNote } from './ComposerModel';
import { paintSketch, paintSketchNoteMove, paintSketchPreview, sketchBranchColor, sketchId, sketchLayout, SKETCH_NOTE_SIZE } from './ComposerSketch';
import { RADIUS } from '../design/geometry';
import type { AppearancePreset, BranchColourMode } from '../settings';


export const COMPOSER_VIEW = 'canvas-mind-map-composer';
export class ComposerView extends ItemView {
    private history = new ComposerHistory(newDraft());
    private get draft() { return this.history.draft; }
    private engine = new OrganicLayoutEngine();
    private renderer = new OrganicMindMapRenderer();
    private viewport = new OrganicViewportController();
    private result?: OrganicLayoutResult;
    /**
     * Branch identity carried between renders. The layout engine re-derives each top-level
     * branch's side from subtree weight when it has no memory, so adding a single child reorders
     * those weights and every branch swaps hemispheres — which the anchor pin then converts into
     * a whole-scene translation. Keeping the assignment is what makes the map hold still.
     */
    private branchStyles: Record<string, { color: string; side: number }> = {};
    private svg!: SVGSVGElement; private scene!: SVGGElement;
    private stage!: HTMLElement; private panel!: HTMLElement; private body!: HTMLTextAreaElement;
    private breadcrumb!: HTMLElement; private status!: HTMLElement; private split!: HTMLElement;
    private nameInput?: HTMLTextAreaElement; private finishName?: (cancel?: boolean) => void;
    private editingActive = false;
    private bodyPreview!: HTMLButtonElement; private ideaInput!: HTMLTextAreaElement;
    private expandedIdeas = new Set<string>(); private ideaQuery = '';
    private layoutRect?: DOMRect; private resizing = false;
    private metricContext?: CanvasRenderingContext2D; private metricDocument?: Document; private measureFamily = 'sans-serif';
    private surfaceCleanups: (() => void)[] = []; private registeredCleanup = false;
    private autoPanel = false; private creating = false; private closed = false;
    private initialized = false; private dragCleanup?: () => void;
    private drawer!: HTMLElement; private drawerList!: HTMLElement; private drawerOpen = false;
    private searchBar!: HTMLElement; private searchInput!: HTMLInputElement; private searchLabel!: HTMLElement;
    private query = ''; private searchScope: SearchScope = 'titles'; private searchIndex = 0;
    private documentButton!: HTMLButtonElement; private ideasButton!: HTMLButtonElement; private contextBar!: HTMLElement; private emptyHint!: HTMLElement; private pinButton!: HTMLButtonElement; private interacted = false;
    private selectionAnchor?: string;
    private modeButton!: HTMLButtonElement; private arrangeButton!: HTMLButtonElement;
    private sketchTool: 'select' | 'link' | 'arrow' | 'ellipse' | 'highlight' | 'text' = 'select';
    private suppressSketchClick = false;
    private selectedNote?: string; private selectedAnnotation?: string; private selectedLink?: string; private linkStart?: string;
    private sketchTools!: HTMLElement;
    private get selected(): string[] {
        const valid = new Set(entries(this.draft, true).map(e => e.node.id));
        const ids = (this.draft.selections ?? [this.draft.selection]).filter(id => valid.has(id));
        return ids.length ? ids : [this.draft.selection];
    }
    constructor(leaf: WorkspaceLeaf, private store: ComposerStore, private appearance: () => AppearancePreset = () => 'obsidian',
        private applyAppearance?: (element: HTMLElement) => void,
        private branchColour: () => BranchColourMode = () => 'palette') { super(leaf); }
    getViewType(): string { return COMPOSER_VIEW; }
    getDisplayText(): string { return `${this.draft.root.title || ct('Untitled')} · Composer`; }
    getIcon(): string { return 'file-plus-2'; }
    sourceRenamed(oldPath: string, newPath: string): void { if (this.draft.createdPath === oldPath) { this.draft.createdPath = newPath; this.remember(); } }
    sourceDeleted(path: string): void { if (this.draft.createdPath === path) { delete this.draft.createdPath; this.remember(); } }
    focusMap(): void { this.stage.focus(); }
    getState(): Record<string, unknown> { return { draftId: this.draft.draftId }; }
    async setState(state: { draftId?: string; targetFolder?: string }, result: { history: boolean }): Promise<void> {
        this.finishName?.(); this.dragCleanup?.();
        const draft = state.draftId && this.store.data[state.draftId];
        if (state.draftId && !draft) { new Notice(ct('This draft could not be found. Open a saved draft from Restore Composer Draft.')); }
        this.history = new ComposerHistory(draft ? clone(draft) : this.store.create(state.targetFolder));
        // A different draft has different node ids, so the carried assignment no longer describes
        // anything on screen.
        this.branchStyles = {};
        this.initialized = true; this.store.put(this.draft);
        this.render();
        if (this.draft.viewport) {
            this.viewport.scale = this.draft.viewport.zoom;
            this.viewport.center(this.draft.viewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
        } else this.fit();
        await super.setState(state, result);
    }
    async onOpen(): Promise<void> {
        this.surfaceCleanups.splice(0).forEach(cleanup => cleanup()); this.layoutRect = undefined; this.resizing = true;
        if (!this.registeredCleanup) { this.registeredCleanup = true; this.register(() => { this.surfaceCleanups.splice(0).forEach(cleanup => cleanup()); this.dragCleanup?.(); this.viewport.cancel(); this.renderer.close(); }); }
        this.contentEl.empty(); this.contentEl.addClass('cmm-organic-view', 'cmm-composer');
        // Touch devices have no hover, so hover-only affordances are promoted to always-on.
        if (Platform.isMobile) this.contentEl.addClass('is-touch');
        this.contentEl.dataset.cmmAppearance = this.appearance();
        this.applyAppearance?.(this.contentEl);
        this.scope = new Scope(this.app.scope);
        this.scope.register([], 'F2', event => { if ((event.target as Element)?.closest?.('input, textarea, [contenteditable=true]')) return true; if (this.selectedNote) this.renameNote(); else this.rename(false); return false; });
        this.scope.register(['Mod'], 'f', event => { if ((event.target as Element)?.closest?.('input, textarea')) return true; this.openSearch(); return false; });
        for (const [modifiers, key] of [[['Mod'], 'z'], [['Mod', 'Shift'], 'z'], [['Mod'], 'Enter']] as const)
            this.scope.register([...modifiers], key, event => { if ((event.target as Element)?.closest?.('input, textarea') && event.target !== this.body) return true; this.key(event); return false; });
        const toolbar = this.contentEl.createDiv({ cls: 'cmm-composer-toolbar' });
        this.documentButton = this.button(toolbar, ct('Untitled'), () => { this.select(this.draft.root.id); this.rename(false); });
        this.documentButton.classList.add('cmm-composer-document-name');
        this.modeButton = this.button(toolbar, '', () => {
            if (this.draft.mode === 'sketch') {
                this.selectedNote = undefined; this.selectedAnnotation = undefined; this.selectedLink = undefined;
                this.sketchTool = 'select'; this.linkStart = undefined;
            }
            this.change(draft => { draft.mode = draft.mode === 'sketch' ? 'structured' : 'sketch'; }, '', true);
        });
        this.modeButton.classList.add('cmm-composer-mode');
        this.arrangeButton = this.button(toolbar, ct('Arrange layout'), () => this.arrangeSketch());
        const searchButton = this.button(toolbar, '', () => this.openSearch()); this.iconButton(searchButton, 'search', ct('Search'));
        const viewButton = this.button(toolbar, '', event => this.viewMenu(event)); this.iconButton(viewButton, 'sliders-horizontal', ct('View'));
        const more = this.button(toolbar, '', event => this.documentMenu(event)); setIcon(more, 'ellipsis'); more.setAttribute('aria-label', ct('More'));
        this.button(toolbar, ct('Create Note'), () => this.createNote()).addClass('mod-cta');
        this.searchBar = this.contentEl.createDiv({ cls: 'cmm-composer-search' }); this.searchBar.hidden = true;
        this.searchInput = this.searchBar.createEl('input', { type: 'search', attr: { placeholder: ct('Search document and unsorted ideas'), 'aria-label': ct('Search Composer') } });
        const scope = this.searchBar.createEl('select', { attr: { 'aria-label': ct('Search scope') } });
        for (const [value, text] of [['titles', ct('Titles')], ['bodies', ct('Bodies')], ['everything', ct('Everything')]]) scope.createEl('option', { value, text });
        scope.onchange = () => { this.searchScope = scope.value as SearchScope; this.searchIndex = 0; this.searchJump(); };
        this.searchInput.oninput = () => { this.query = this.searchInput.value; this.searchIndex = 0; this.searchJump(); };
        this.searchInput.onkeydown = event => { if (event.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.searchIndex += event.shiftKey ? -1 : 1; this.searchJump(); } else if (event.key === 'Escape') { event.stopPropagation(); this.closeSearch(); } };
        this.searchLabel = this.searchBar.createSpan();
        this.button(this.searchBar, ct('Previous'), () => { this.searchIndex--; this.searchJump(); });
        this.button(this.searchBar, ct('Next'), () => { this.searchIndex++; this.searchJump(); });
        this.button(this.searchBar, ct('Close search'), () => this.closeSearch());
        this.split = this.contentEl.createDiv({ cls: 'cmm-composer-split' });
        this.drawer = this.split.createDiv({ cls: 'cmm-composer-unsorted', attr: { 'aria-label': ct('Unsorted Ideas') } }); this.drawer.hidden = true;
        const inboxHeader = this.drawer.createDiv({ cls: 'cmm-composer-inbox-header' });
        inboxHeader.createEl('strong', { text: ct('Ideas Inbox') });
        const closeInbox = this.button(inboxHeader, '', () => { this.drawerOpen = false; this.renderDrawer(); this.stage.focus(); });
        this.iconButton(closeInbox, 'x', ct('Close Ideas'));
        this.buildInboxInput();
        this.drawerList = this.drawer.createDiv({ cls: 'cmm-composer-unsorted-list' });
        this.listen(this.drawerList, 'pointerdown', event => this.pointer(event));
        this.stage = this.split.createDiv({ cls: 'cmm-composer-stage', attr: { tabindex: '0', 'aria-label': ct('Mind map. Enter adds a section, Tab adds a child.') } });
        this.svg = svgElement(this.contentEl.ownerDocument, 'svg', { class: 'cmm-organic-svg', width: '100%', height: '100%' });
        this.scene = svgElement(this.contentEl.ownerDocument, 'g'); this.svg.append(this.scene); this.stage.append(this.svg);
        this.sketchTools = this.stage.createDiv({ cls: 'cmm-composer-sketch-tools', attr: { role: 'toolbar', 'aria-label': ct('Sketch tools') } });
        this.button(this.sketchTools, ct('Free note'), () => this.createFreeNote(this.canvasPoint(this.svg.getBoundingClientRect().left + this.svg.clientWidth / 2, this.svg.getBoundingClientRect().top + this.svg.clientHeight / 2)));
        for (const [tool, label] of [['select', 'Select'], ['link', 'Connect'], ['arrow', 'Arrow'], ['ellipse', 'Circle'], ['highlight', 'Highlight'], ['text', 'Text note']] as const) {
            const button = this.button(this.sketchTools, ct(label), () => { this.sketchTool = tool; this.linkStart = undefined; this.updateSketchControls(); });
            button.dataset.tool = tool;
        }
        this.listen(this.sketchTools, 'keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault(); event.stopPropagation(); this.sketchTool = 'select'; this.linkStart = undefined;
            this.updateSketchControls(); this.stage.focus();
        });
        const divider = this.split.createDiv({ cls: 'cmm-composer-divider', attr: { role: 'separator', tabindex: '0', 'aria-label': ct('Resize body panel'), 'aria-orientation': 'vertical' } });
        divider.onpointerdown = event => {
            event.preventDefault(); divider.setPointerCapture(event.pointerId);
            const resize = (e: PointerEvent) => { const bounds = this.split.getBoundingClientRect(); this.draft.panelWidth = Math.max(.2, Math.min(.7, (bounds.right - e.clientX) / bounds.width)); this.applyPanel(); };
            divider.onpointermove = resize; divider.onpointerup = () => { divider.onpointermove = null; this.remember(); };
            divider.onpointercancel = () => { divider.onpointermove = null; };
        };
        divider.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.draft.panelWidth = Math.max(.2, Math.min(.7, this.draft.panelWidth + (event.key === 'ArrowLeft' ? .05 : -.05))); this.applyPanel(); this.remember(); } };
        this.panel = this.split.createDiv({ cls: 'cmm-composer-body' });
        this.breadcrumb = this.panel.createDiv({ cls: 'cmm-composer-breadcrumb' });
        const inspectorActions = this.panel.createDiv({ cls: 'cmm-composer-inspector-actions' });
        this.pinButton = this.button(inspectorActions, ct('Pin'), () => { this.draft.panel = this.draft.panel === 'show' ? 'auto' : 'show'; this.applyPanel(); this.remember(); });
        this.button(inspectorActions, ct('Close Body'), () => { this.autoPanel = false; this.draft.panel = 'hide'; this.applyPanel(); this.remember(); this.stage.focus(); });
        this.ideasButton = this.button(this.stage, ct('Ideas'), () => { this.drawerOpen = !this.drawerOpen; this.renderDrawer(); }); this.ideasButton.classList.add('cmm-composer-ideas-entry');
        this.emptyHint = this.stage.createDiv({ cls: 'cmm-composer-empty-hint', text: ct('Enter to add a section') });
        this.contextBar = this.stage.createDiv({ cls: 'cmm-composer-context', attr: { 'aria-label': ct('Node actions'), role: 'toolbar' } });
        const nodeMore = this.button(this.contextBar, '', event => this.nodeMenu(event)); setIcon(nodeMore, 'ellipsis'); nodeMore.setAttribute('aria-label', ct('Node menu'));
        this.bodyPreview = this.button(this.stage, ct('Add body…'), () => this.openBody());
        this.bodyPreview.className = 'cmm-composer-body-preview';
        this.body = this.panel.createEl('textarea', { attr: { 'aria-label': ct('Direct section body'), placeholder: ct('Write paragraphs, lists, quotes or code here. Create section headings in the mind map.') } });
        this.body.oninput = () => {
            const id = this.draft.selection, text = this.body.value;
            if (this.selectedNote) this.change(draft => { const note = draft.sketch?.notes.find(n => n.id === this.selectedNote); if (note) note.body = text; }, `note-body:${this.selectedNote}`, false);
            else this.change(draft => { this.node(id, draft).body = text; }, `body:${id}`, false);
        };
        this.status = this.contentEl.createDiv({ cls: 'cmm-composer-status' });
        this.surfaceCleanups.push(this.store.subscribe(() => this.updateStatus()));
        this.listen(this.contentEl, 'keydown', event => this.key(event));
        // Composer owns structure shortcuts even when keyboard focus is on an SVG heading.
        this.listen(this.stage, 'keydown', event => { if ((event.target as Element).closest('svg') && !(event.target as Element).closest('[role=button], [role=checkbox]')) this.key(event); }, true);
        this.listen(this.stage, 'dblclick', event => { const note = this.noteAt(event.target); if (note) { this.selectNote(note); this.renameNote(); return; }
            const annotation = (event.target as Element).closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
            if (annotation) { const mark = this.draft.sketch?.annotations.find(a => a.id === annotation); if (mark?.kind === 'text') this.prompt(ct('Text note'), mark.text ?? '', value => this.change(draft => { const target = draft.sketch?.annotations.find(a => a.id === annotation); if (target) target.text = value; })); return; }
            const id = this.idAt(event.target); if (id) { this.select(id); this.rename(false); } else if (this.draft.mode === 'sketch' && (event.target as Element).closest('svg')) this.createFreeNote(this.canvasPoint(event.clientX, event.clientY)); });
        this.listen(this.stage, 'pointerdown', event => { if ((event.target as Element).closest('svg')) this.draft.mode === 'sketch' ? this.sketchPointer(event) : this.pointer(event); });
        this.listen(this.stage, 'click', event => { if (this.suppressSketchClick && (event.target as Element).closest('svg')) { this.suppressSketchClick = false; event.preventDefault(); event.stopPropagation(); return; } if (this.draft.mode === 'sketch' && this.sketchTool === 'link' && (this.idAt(event.target) || this.noteAt(event.target))) { event.preventDefault(); event.stopPropagation(); } }, true);
        this.listen(this.stage, 'dragover', event => { if (this.draft.mode === 'sketch' && event.dataTransfer?.types.includes('application/x-cmm-idea')) event.preventDefault(); });
        this.listen(this.stage, 'drop', event => { if (this.draft.mode !== 'sketch') return; const id = event.dataTransfer?.getData('application/x-cmm-idea');
            const idea = entries(this.draft, true).find(e => e.unsorted && e.node.id === id)?.node; if (!idea) return;
            event.preventDefault(); this.createFreeNote(this.canvasPoint(event.clientX, event.clientY), idea.title, idea.body, id, false); });
        this.listen(this.stage, 'contextmenu', event => { const id = this.noteAt(event.target); if (!id) return; event.preventDefault(); this.selectNote(id);
            const menu = new Menu(); menu.addItem(item => item.setTitle(ct('Rename')).onClick(() => this.renameNote()));
            menu.addItem(item => item.setTitle(ct('Convert to heading')).onClick(() => this.convertNote(id)));
            menu.addItem(item => item.setTitle(ct('Delete')).onClick(() => { this.selectedNote = id; this.deleteSketchSelection(); })); menu.showAtMouseEvent(event); });
        this.listen(this.stage, 'wheel', event => {
            event.preventDefault(); const bounds = this.svg.getBoundingClientRect();
            this.viewport.zoom(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top); this.transform(); this.remember();
        }, { passive: false });
        this.render();
        this.layoutRect = this.svg.getBoundingClientRect();
        this.resizing = false;
        const observer = new ResizeObserver(() => this.preserveLayout()); observer.observe(this.stage);
        this.surfaceCleanups.push(() => observer.disconnect());
    }
    private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void {
        el.addEventListener(type, listener, options); this.surfaceCleanups.push(() => el.removeEventListener(type, listener, options));
    }
    async refreshLanguage(): Promise<void> {
        this.finishName?.(); this.dragCleanup?.();
        const capture = this.ideaInput.value, query = this.query, inboxQuery = this.ideaQuery;
        const searchOpen = !this.searchBar.hidden;
        await this.onOpen();
        this.ideaInput.value = capture; this.ideaInput.dispatchEvent(new Event('input'));
        this.searchInput.value = query; this.searchBar.hidden = !searchOpen;
        const inboxSearch = this.drawer.querySelector<HTMLInputElement>('.cmm-composer-inbox-search'); if (inboxSearch) inboxSearch.value = inboxQuery;
        this.transform(); this.stage.focus();
    }
    async onClose(): Promise<void> {
        this.finishName?.(); this.closed = true;
        this.dragCleanup?.(); this.surfaceCleanups.splice(0).forEach(cleanup => cleanup());
        if (this.initialized) { this.remember(); try { await this.store.flush(); } catch { this.recovery(); } }
    }
    private node(id = this.draft.selection, draft = this.draft): ComposerNode { return entries(draft, true).find(e => e.node.id === id)?.node ?? draft.root; }
    private button(parent: HTMLElement, text: string, callback: (event: MouseEvent) => void): HTMLButtonElement {
        const button = parent.createEl('button', { text }); button.onclick = callback; return button;
    }
    private iconButton(button: HTMLButtonElement, icon: string, label: string): void {
        setIcon(button, icon); button.setAttribute('aria-label', label); button.title = label;
    }
    private change(edit: (draft: ComposerDraft) => void, group = '', render = true, anchorEdit = true): boolean {
        const anchor = this.draft.selection;
        try { this.history.change(edit, group); if (render) { this.render(anchorEdit, anchor); this.ensureVisible(); } this.remember(); return true; }
        catch (error) { new Notice(ct((error as Error).message)); return false; }
    }
    private remember(): void {
        if (!this.initialized || this.editingActive) return;
        // The saved viewport centre is derived from the pane size, so a fabricated fallback would
        // restore the draft at a wrong origin. Skip recording until the pane has been measured.
        const width = this.svg?.clientWidth ?? 0, height = this.svg?.clientHeight ?? 0;
        if (width > 0 && height > 0) this.draft.viewport = this.viewport.snapshot(width, height);
        this.store.put(this.draft); this.app.workspace.requestSaveLayout();
    }
    private updateStatus(): void {
        if (!this.status) return;
        const status = this.store.status;
        this.status.textContent = status === 'Draft saved' ? ct('Saved')
            : status === 'Saving draft…' ? ct('Saving…')
            : status === 'Draft not saved yet' ? ct('Not saved yet')
            : ct(status);
    }
    private render(anchor = false, anchorId = this.draft.selection): void {
        if (!this.scene) return;
        if (this.selectedNote && !this.draft.sketch?.notes.some(n => n.id === this.selectedNote)) this.selectedNote = undefined;
        if (this.selectedAnnotation && !this.draft.sketch?.annotations.some(a => a.id === this.selectedAnnotation)) this.selectedAnnotation = undefined;
        if (this.selectedLink && !this.draft.sketch?.links.some(l => l.id === this.selectedLink)) this.selectedLink = undefined;
        const old = this.result?.nodes.find(n => n.id === anchorId);
        const context = this.measureContext();
        const matches = searchDraft(this.draft, this.query, this.searchScope);
        this.searchIndex = matches.length ? Math.min(this.searchIndex, matches.length - 1) : 0;
        const projection = composerProjection(this.draft, matches[this.searchIndex]);
        const automatic = this.engine.layout(projection.model, { style: this.draft.layout, fontScale: this.draft.layout === 'compact-organic' ? .72 : .8, branchWidth: 1.8,
            collapsed: projection.collapsed, branchStyles: this.branchStyles, referenceModel: projection.reference,
            measureText: (text, size, weight) => { context.font = `${weight} ${size}px ${this.measureFamily}`; return context.measureText(text).width; } });
        if (automatic.branchStyles) this.branchStyles = automatic.branchStyles;
        const next = this.draft.mode === 'sketch' ? sketchLayout(automatic, this.draft.sketch ?? emptySketch()) : automatic;
        const current = next.nodes.find(n => n.id === anchorId);
        if (anchor && old && current) this.viewport.pan((old.x - current.x) * this.viewport.scale, (old.y - current.y) * this.viewport.scale);
        const palette = this.branchColour() === 'palette';
        next.nodes.forEach(node => { node.color = palette && node.depth > 0 ? node.color : 'var(--cmm-ink)'; });
        next.branches.forEach(branch => { branch.color = this.draft.mode === 'sketch'
            ? sketchBranchColor(next.nodes.find(n => n.id === branch.childId)?.rootBranchId ?? branch.childId)
            : palette ? branch.color : 'var(--cmm-branch)'; });
        this.result = next;
        this.renderer.render(this.scene, next, { navigate: (id, event) => this.select(id, event), toggle: id => this.change(draft => { const node = this.node(id, draft); node.collapsed = !node.collapsed; }),
            toggleLabel: collapsed => collapsed ? ct('Expand branch') : ct('Collapse branch'), selected: this.selectedNote ? null : this.draft.selection,
            matches: new Set(matches), currentMatch: matches[this.searchIndex],
            surface: this.draft.mode === 'sketch'
                // Free placement draws its own hand-drawn outline, so the card is flattened away.
                ? { ...DEFAULT_SURFACE, cardFill: 'none', rootFill: 'none', cardStroke: 'none', rootStroke: 'none', cardStrokeWidth: 0, rootStrokeWidth: 0 }
                : { ...DEFAULT_SURFACE, cardFill: 'var(--cmm-node-fill, var(--cmm-paper-raised))' },
            contextMenu: (id, event) => { if (!this.selected.includes(id)) this.select(id); this.nodeMenu(event); } });
        if (this.draft.mode === 'sketch') paintSketch(this.scene, next, this.draft.sketch ?? emptySketch(), this.selectedNote, this.selectedAnnotation, this.selectedLink);
        else this.scene.querySelector('.cmm-sketch-overlays')?.remove();
        // Node chrome is reused across renders: rebuilding it for every keystroke and drag frame
        // was the dominant cost in this view.
        const geometryById = new Map(next.nodes.map(n => [n.id, n]));
        for (const group of Array.from(this.scene.querySelectorAll<SVGGElement>('[data-node-id]'))) {
            const id = group.getAttribute('data-node-id')!, node = this.node(id);
            group.classList.toggle('is-multiselected', !this.selectedNote && this.selected.includes(id)); group.classList.add(`is-${node.type}`);
            const geometry = geometryById.get(id); if (!geometry) continue;
            let add = group.querySelector<SVGGElement>('.cmm-composer-node-add');
            if (!add) {
                add = svgElement(this.contentEl.ownerDocument, 'g', { class: 'cmm-composer-node-add', role: 'button', tabindex: 0 });
                // A pill badge at the card edge; the plus is drawn as a cross so it matches the
                // other mark weights instead of using a text glyph.
                const plus = svgElement(this.contentEl.ownerDocument, 'g', { class: 'cmm-composer-node-add-mark' });
                plus.append(svgElement(this.contentEl.ownerDocument, 'path', {
                    d: 'M 12 8 L 12 16 M 8 12 L 16 12',
                    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
                add.append(svgElement(this.contentEl.ownerDocument, 'rect',
                    { width: 24, height: 24, rx: RADIUS.pill, class: 'cmm-composer-node-add-box' }), plus);
                const create = (event: Event) => { event.preventDefault(); event.stopPropagation(); this.select(id); this.add(true); };
                // Obsidian does not synthesize a click from a real tap on SVG, so commit the press.
                add.addEventListener('pointerup', event => { if (event.button === 0) create(event); });
                add.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') create(event); });
            }
            if (add.parentNode !== group) group.append(add);
            add.setAttribute('aria-label', ct('Add child'));
            add.setAttribute('transform', `translate(${geometry.width + 5} ${geometry.height / 2 - 11})`);
            let check = group.querySelector<SVGGElement>('[role="checkbox"]');
            if (node.type === 'todo') {
                if (!check) {
                    check = svgElement(this.contentEl.ownerDocument, 'g', { role: 'checkbox', tabindex: '0', transform: 'translate(-22 8)' });
                    const toggle = (event: Event) => { event.preventDefault(); event.stopPropagation(); this.change(draft => { const todo = this.node(id, draft); todo.checked = !todo.checked; }); };
                    check.addEventListener('pointerup', event => { if (event.button === 0) toggle(event); });
                    check.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') toggle(event); });
                    group.append(check);
                }
                check.setAttribute('aria-label', ct('Complete {title}', { title: node.title }));
                check.setAttribute('aria-checked', String(!!node.checked));
                check.replaceChildren(
                    svgElement(this.contentEl.ownerDocument, 'rect', { width: 16, height: 16, rx: RADIUS.xs,
                        fill: node.checked ? 'var(--interactive-accent)' : 'var(--background-primary)', stroke: 'var(--text-muted)' }),
                    ...(node.checked ? [svgElement(this.contentEl.ownerDocument, 'path',
                        { d: 'M3 8 L7 12 L13 4', fill: 'none', stroke: 'var(--text-on-accent)', 'stroke-width': 2 })] : []));
            } else check?.remove();
        }
        this.transform(); this.syncBody(); this.applyPanel(); this.updateStatus();
        this.renderDrawer();
        this.searchLabel.textContent = matches.length ? `${this.searchIndex + 1} / ${matches.length}` : this.query ? ct('No results') : '';
        this.documentButton.textContent = this.draft.root.title || ct('Untitled');
        this.updateSketchControls();
        this.emptyHint.hidden = !!this.draft.root.children.length;
        this.positionContext();
    }
    /** One measurement context per view, matching the family the map actually renders with. */
    private measureContext(): CanvasRenderingContext2D {
        const doc = this.contentEl.ownerDocument;
        if (!this.metricContext || this.metricDocument !== doc) {
            const context = doc.createElement('canvas').getContext('2d');
            if (!context) throw new Error('A 2D measurement context is required to lay out Composer.');
            this.metricContext = context; this.metricDocument = doc;
            const computed = doc.defaultView?.getComputedStyle(this.contentEl);
            // Measurement and paint must agree, including the optional serif display face.
            this.measureFamily = computed?.getPropertyValue('--cmm-font-display').trim()
                || computed?.fontFamily || 'sans-serif';
        }
        return this.metricContext;
    }
    private transform(): void {
        this.scene.setAttribute('transform', `translate(${this.viewport.offset.x} ${this.viewport.offset.y}) scale(${this.viewport.scale})`);
        this.positionContext();
    }
    private fit(): void { if (this.result) { this.viewport.fit(this.result.bounds, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform(); this.remember(); } }
    private zoom(factor: number): void { this.viewport.zoom(factor, this.svg.clientWidth / 2, this.svg.clientHeight / 2); this.transform(); this.remember(); }
    private select(id: string, event?: MouseEvent | KeyboardEvent): void {
        this.selectedNote = undefined; this.selectedAnnotation = undefined; this.selectedLink = undefined;
        this.finishName?.(); const previous = this.selected;
        if (event?.shiftKey && this.selectionAnchor) {
            const visible = this.visibleOrder(), a = visible.indexOf(this.selectionAnchor), b = visible.indexOf(id);
            this.draft.selections = a >= 0 && b >= 0 ? visible.slice(Math.min(a, b), Math.max(a, b) + 1).filter(key => key !== this.draft.root.id) : [id];
        } else if (event?.ctrlKey || event?.metaKey) {
            this.draft.selections = previous.includes(id) ? previous.filter(key => key !== id) : [...previous.filter(key => key !== this.draft.root.id), id];
            this.selectionAnchor = id;
        } else { this.draft.selections = [id]; this.selectionAnchor = id; }
        this.draft.selection = this.draft.selections.includes(id) ? id : this.draft.selections[0] ?? this.draft.root.id;
        // Selection must preserve hit targets across a native click / dblclick sequence.
        this.interacted = true;
        for (const group of Array.from(this.scene.querySelectorAll('[data-node-id]'))) {
            const key = group.getAttribute('data-node-id')!;
            group.classList.toggle('is-selected', key === this.draft.selection);
            group.classList.toggle('is-multiselected', this.selected.includes(key));
        }
        for (const row of Array.from(this.drawerList.children)) row.classList.toggle('is-selected', this.selected.includes(row.getAttribute('data-node-id')!));
        this.syncBody(); this.positionContext(); this.stage.focus(); this.remember();
    }
    private syncBody(): void {
        const free = this.draft.sketch?.notes.find(n => n.id === this.selectedNote);
        if (free) {
            if (this.body.value !== free.body) this.body.value = free.body;
            this.breadcrumb.empty(); this.breadcrumb.createSpan({ text: ct('Free note') });
            this.button(this.breadcrumb, free.title, () => this.renameNote());
            this.body.setAttribute('aria-label', `${ct('Free note')}: ${free.title}`);
            this.bodyPreview.textContent = plainPreview(free.body) || ct('Add body…');
            return;
        }
        const node = this.node(); if (this.body.value !== node.body) this.body.value = node.body;
        const all = entries(this.draft, true), path: ComposerNode[] = []; let current: ComposerNode | undefined = node;
        while (current) { path.unshift(current); current = all.find(e => e.node.id === current!.id)?.parent; }
        this.breadcrumb.empty();
        for (const item of path) { this.button(this.breadcrumb, item.title || ct('Untitled'), () => this.select(item.id)); }
        this.body.setAttribute('aria-label', node === this.draft.root ? ct('Document introduction') : ct('{title}: direct body', { title: node.title }));
        this.bodyPreview.textContent = plainPreview(node.body) || ct('Add body…');
        this.bodyPreview.title = ct('Edit body');

    }
    private applyPanel(): void {
        const visible = this.draft.panel === 'show' || (this.draft.panel === 'auto' && (this.autoPanel || this.draft.mode === 'sketch'));
        this.pinButton?.setAttribute('aria-pressed', String(this.draft.panel === 'show'));
        this.split.classList.toggle('has-body', visible); this.panel.setCssStyles({ width: `${this.draft.panelWidth * 100}%` });
        this.bodyPreview.hidden = visible;
        this.bodyPreview.textContent = plainPreview(this.draft.sketch?.notes.find(n => n.id === this.selectedNote)?.body ?? this.node().body) || ct('Add body…');
        this.preserveLayout();
    }
    private preserveLayout(): void {
        if (!this.svg || this.resizing) return;
        const rect = this.svg.getBoundingClientRect(), old = this.layoutRect;
        this.layoutRect = rect;
        if (!old || !rect.width || (old.left === rect.left && old.top === rect.top && old.width === rect.width && old.height === rect.height)) return;
        this.resizing = true;
        const node = this.result?.nodes.find(n => n.id === this.draft.selection);
        if (node) {
            this.viewport.pan(old.left - rect.left, old.top - rect.top);
            // The pan above is this method's own mutation, so repaint here: ensureVisible returns
            // without transforming when the node is already inside its margins.
            this.transform();
            this.ensureVisible();
        } else { this.viewport.pan((rect.width - old.width) / 2, (rect.height - old.height) / 2); this.transform(); }
        this.resizing = false; this.remember();
    }
    private visibleOrder(): string[] {
        const visible = new Set(this.result?.nodes.map(n => n.id));
        if (this.drawerOpen) this.drawerList.querySelectorAll('[data-node-id]').forEach(el => visible.add(el.getAttribute('data-node-id')!));
        return entries(this.draft, true).filter(e => visible.has(e.node.id)).map(e => e.node.id);
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
            const id = matches[this.searchIndex];
            if (id) { this.draft.selection = id; this.draft.selections = [id]; }
            const all = entries(this.draft, true);
            let parentId = all.find(e => e.node.id === id)?.parent?.id;
            if (parentId && all.find(e => e.node.id === id)?.unsorted) {
                this.drawerOpen = true; this.ideaQuery = '';
                while (parentId) {
                    this.expandedIdeas.add(parentId);
                    parentId = all.find(e => e.node.id === parentId)?.parent?.id;
                }
            }
        }
        this.render(); this.ensureVisible(); this.searchInput.focus(); this.remember();
    }
    private focusBranch(id?: string): void {
        this.finishName?.();
        const next = id ?? (this.draft.focusNode ? null : this.draft.selection);
        if (next && !entries(this.draft).some(e => e.node.id === next)) { new Notice(ct('Move this idea into the document before focusing its branch.')); return; }
        this.draft.focusNode = next === this.draft.root.id ? null : next;
        this.query = ''; this.searchInput.value = ''; this.render(); this.fit(); this.stage.focus(); this.remember();
    }
    private renderDrawer(): void {
        this.ideasButton.textContent = `${ct('Ideas')}${this.draft.unsorted?.length ? ` ${this.draft.unsorted.length}` : ''}`;
        this.ideasButton.setAttribute('aria-expanded', String(this.drawerOpen));
        this.ideasButton.hidden = this.drawerOpen;
        this.drawer.hidden = !this.drawerOpen; this.preserveLayout(); this.drawerList.empty();
        if (!this.drawerOpen) return;
        const matches = searchDraft(this.draft, this.query, this.searchScope);
        const all = entries(this.draft, true).filter(e => e.unsorted);
        const needle = this.ideaQuery.trim().toLocaleLowerCase();
        const subtreeMatches = (node: ComposerNode): boolean => !needle || `${node.title} ${node.body}`.toLocaleLowerCase().includes(needle) || node.children.some(subtreeMatches);
        const draw = (node: ComposerNode, depth: number, inboxRoot = node.id) => {
            if (!subtreeMatches(node)) return;
            const row = this.drawerList.createDiv({ cls: 'cmm-composer-unsorted-node', attr: { 'data-node-id': node.id, 'data-inbox-root': inboxRoot } });
            row.setCssStyles({ marginLeft: `${(depth - 1) * 12}px` });
            row.classList.toggle('is-selected', this.selected.includes(node.id)); row.classList.toggle('is-match', matches.includes(node.id));
            const label = this.button(row, `${node.type === 'todo' ? node.checked ? '☑ ' : '☐ ' : ''}${node.title || ct('New idea')}`, event => this.select(node.id, event));
            label.className = 'cmm-composer-idea-title';
            row.draggable = this.draft.mode === 'sketch';
            row.ondragstart = event => { event.dataTransfer?.setData('application/x-cmm-idea', node.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'; };
            label.ondblclick = () => { this.select(node.id); this.rename(false); };
            if (node.body.trim()) { const preview = row.createDiv({ cls: 'cmm-composer-idea-preview', text: plainPreview(node.body) }); preview.onclick = event => this.select(node.id, event); }
            if (node.children.length) {
                const count = all.filter(e => { let p = e.parent; while (p) { if (p.id === node.id) return true; p = all.find(a => a.node.id === p!.id)?.parent; } return false; }).length;
                const fold = this.button(row, `${this.expandedIdeas.has(node.id) ? '▾' : '▸'} ${count}`, () => {
                    this.finishName?.(); this.expandedIdeas.has(node.id) ? this.expandedIdeas.delete(node.id) : this.expandedIdeas.add(node.id); this.renderDrawer();
                }); fold.className = 'cmm-composer-idea-fold'; fold.setAttribute('aria-label', ct('Expand / Collapse')); fold.setAttribute('aria-expanded', String(this.expandedIdeas.has(node.id)));
                fold.onpointerdown = event => event.stopPropagation();
            }
            row.oncontextmenu = event => { event.preventDefault(); if (!this.selected.includes(node.id)) this.select(node.id); this.nodeMenu(event); };
            if (needle || this.expandedIdeas.has(node.id)) node.children.forEach(child => draw(child, depth + 1, inboxRoot));
        };
        (this.draft.unsorted ?? []).forEach(node => draw(node, 1));
        if (!this.draft.unsorted?.length) this.drawerList.createEl('p', { text: ct('Capture ideas here before deciding where they belong.') });
    }
    private buildInboxInput(): void {
        this.ideaInput = this.drawer.createEl('textarea', { cls: 'cmm-composer-capture', attr: { rows: '1', placeholder: ct('Capture an idea…'), 'aria-label': ct('Capture an idea…') } });
        const choices = this.drawer.createDiv({ cls: 'cmm-composer-paste-options' }); choices.hidden = true;
        const submit = (split = false) => {
            const lines = this.ideaInput.value.split(/\r?\n/), title = (lines[0] ?? '').trim();
            if (!this.ideaInput.value.trim() || (!split && !title)) return;
            this.finishName?.();
            const nodes = split ? lines.filter(line => line.trim()).map(line => newNode(line.trim(), 'idea')) : [newNode(title, 'idea')];
            const first = nodes[0];
            if (!first) return;
            if (!split) first.body = lines.slice(1).join('\n').trim();
            if (this.change(draft => { (draft.unsorted ??= []).push(...nodes); draft.selection = first.id; draft.selections = nodes.map(n => n.id); })) {
                this.ideaInput.value = ''; choices.hidden = true; this.ideaInput.focus();
            }
        };
        this.button(choices, ct('As one idea'), () => submit()); this.button(choices, ct('Split into lines'), () => submit(true));
        this.ideaInput.oninput = () => { choices.hidden = !/[\r\n]/.test(this.ideaInput.value); };
        this.ideaInput.onkeydown = event => {
            if (event.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (choices.hidden) submit(); else choices.querySelector('button')?.focus(); }
        };
        const search = this.drawer.createEl('input', { type: 'search', cls: 'cmm-composer-inbox-search', attr: { placeholder: ct('Search ideas'), 'aria-label': ct('Search ideas') } });
        search.oninput = () => { this.finishName?.(); this.ideaQuery = search.value; this.renderDrawer(); };
    }
    private prompt(title: string, value: string, accept: (value: string) => boolean | void): void {
        const modal = new Modal(this.app); modal.titleEl.setText(title);
        const input = modal.contentEl.createEl('input', { value, attr: { 'aria-label': title } });
        const submit = () => { if (input.value.trim() && accept(input.value.trim()) !== false) { modal.close(); this.stage.focus(); } };
        this.button(modal.contentEl, ct('Cancel'), () => modal.close()); this.button(modal.contentEl, ct('Confirm'), submit);
        input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); } };
        modal.open(); input.focus(); input.select();
    }
    private changeType(type: ComposerNode['type']): void {
        const ids = this.selected.filter(id => id !== this.draft.root.id);
        this.change(draft => { for (const id of ids) this.node(id, draft).type = type; });
    }
    private groupSelection(): void {
        const ids = this.selected;
        this.finishName?.(); this.editingActive = true; this.history.beginEdit();
        if (!this.change(draft => { createParent(draft, ids, ct('New group')); })) { this.history.endEdit(true); this.editingActive = false; return; }
        this.ensureVisible(); this.rename(true);
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
        const modal = new Modal(this.app); modal.titleEl.setText(ct('Document properties'));
        modal.contentEl.createEl('p', { text: ct('YAML frontmatter, without --- delimiters. This is saved with the draft and placed before the introduction.') });
        // A prose hint rather than a raw YAML sample: the sentence-case UI rule requires leading
        // capitals, which is exactly what a YAML key cannot have.
        const input = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery', attr: { 'aria-label': ct('Frontmatter YAML'), placeholder: ct('One key per line, for example tags or status') } }); input.value = this.draft.frontmatter ?? '';
        const error = modal.contentEl.createEl('p', { attr: { role: 'alert' } });
        this.button(modal.contentEl, ct('Cancel'), () => modal.close());
        this.button(modal.contentEl, ct('Save properties'), () => {
            try { validateProperties(input.value); if (this.change(draft => { draft.frontmatter = input.value; })) modal.close(); }
            catch (failure) { error.textContent = ct((failure as Error).message); }
        }); modal.open();
    }
    private copyOutline(): void {
        const text = outlineMarkdown(this.draft);
        const clipboard = this.contentEl.ownerDocument.defaultView!.navigator.clipboard;
        void (clipboard ? clipboard.writeText(text) : Promise.reject(new Error(ct('Clipboard unavailable')))).then(() => new Notice(ct('Outline copied.'))).catch(() => {
            const modal = new Modal(this.app); modal.titleEl.setText(ct('Copy outline'));
            const input = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery' }); input.value = text; input.readOnly = true; modal.open(); input.focus(); input.select();
        });
    }
    renameDocument(title: string): void { this.finishName?.(); this.change(draft => { draft.root.title = title; }); }
    private async openDraft(draft: ComposerDraft): Promise<void> {
        try { this.store.put(draft); await this.store.flush(); const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: COMPOSER_VIEW, active: true, state: { draftId: draft.draftId } });
            (leaf.view as ComposerView).focusMap();
        } catch (error) { new Notice(ct((error as Error).message)); }
    }
    private ensureVisible(): void {
        const node = this.result?.nodes.find(n => n.id === this.draft.selection); if (!node) return;
        const width = this.svg.clientWidth, height = this.svg.clientHeight;
        // An unmeasured pane has no margins to respect. The bounds test below would invert and
        // compute a full-scene translation from a zero-sized box, so do nothing instead.
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        const scale = this.viewport.scale;
        if (!Number.isFinite(scale) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
        const x = node.x * scale + this.viewport.offset.x, y = node.y * scale + this.viewport.offset.y;
        const nodeWidth = node.width * scale, nodeHeight = node.height * scale;
        // A node wider than the pane must not fight its own margins; shrink the inset to fit.
        const marginX = Math.min(24, width / 4), marginY = Math.min(24, height / 4);
        const dx = x < marginX ? marginX - x : x + nodeWidth > width - marginX ? width - marginX - x - nodeWidth : 0;
        const dy = y < marginY ? marginY - y : y + nodeHeight > height - marginY ? height - marginY - y - nodeHeight : 0;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
        // The computed delta is already the minimum that clears the margin, so it is applied as
        // is: a node far off screen needs a correspondingly large pan, and capping it to a card's
        // extent would leave that node permanently unreachable.
        this.viewport.pan(dx, dy);
        this.transform();
    }
    private add(child: boolean): void {
        this.finishName?.(); const id = this.draft.selection, node = newNode('');
        const inInbox = entries(this.draft, true).find(e => e.node.id === id)?.unsorted;
        if (inInbox) { this.drawerOpen = true; this.ideaQuery = ''; if (child) this.expandedIdeas.add(id); }
        this.editingActive = true;
        this.history.beginEdit();
        if (!this.change(draft => {
            const source = entries(draft, true).find(e => e.node.id === id)!;
            const asChild = child || source.node === draft.root;
            const siblings = asChild ? source.node.children : siblingsOf(draft, id);
            siblings.splice(asChild ? siblings.length : siblings.indexOf(source.node) + 1, 0, node);
            if (source.unsorted) node.type = 'idea';
            if (asChild) source.node.collapsed = false;
            draft.selection = node.id; draft.selections = [node.id];
            // Adding a sibling re-centres its group in the layout, so pinning one node here would
            // translate the whole scene by that reflow. Leave the viewport alone: ensureVisible is
            // the only thing allowed to move it.
        }, '', true, false)) { this.history.endEdit(true); this.editingActive = false; return; }
        if (!inInbox && !this.result?.nodes.some(n => n.id === node.id)) {
            this.draft.focusNode = null; this.query = ''; this.searchInput.value = '';
            // Re-render with the node that was being edited pinned, so leaving focus mode cannot
            // translate the scene on top of the layout change.
            this.render(true, id);
        }
        this.ensureVisible(); this.rename(true);
    }
    private rename(fresh: boolean): void {
        this.finishName?.(); const id = this.draft.selection, original = this.node().title;
        const geometry = this.result?.nodes.find(n => n.id === id);
        const row = Array.from(this.drawerList.children).find(row => row.getAttribute('data-node-id') === id) as HTMLElement | undefined;
        if (!geometry && !row) return;
        this.editingActive = true;
        if (!fresh) this.history.beginEdit();
        const input = this.contentEl.ownerDocument.createElement('textarea');
        input.className = geometry ? 'cmm-composer-title-input' : 'cmm-composer-idea-input'; input.rows = 1;
        input.setAttribute('aria-label', fresh ? ct('New section title') : ct('Rename node'));
        input.value = original; this.nameInput = input; this.contextBar.hidden = true;
        let foreign: SVGForeignObjectElement | undefined;
        let box: SVGRectElement | null = null;
        if (geometry) {
            const group = Array.from(this.scene.querySelectorAll('[data-node-id]')).find(el => el.getAttribute('data-node-id') === id)!;
            group.classList.add('is-editing');
            const text = group.querySelector('[role=link] > text'); if (text) text.setAttribute('visibility', 'hidden');
            box = group.querySelector('.cmm-organic-hitbox');
            foreign = svgElement(this.contentEl.ownerDocument, 'foreignObject', { x: 0, y: 0, width: geometry.width, height: geometry.height });
            input.setCssStyles({ fontSize: `${geometry.fontSize}px`, fontWeight: String(geometry.fontWeight), height: `${geometry.height}px` });
            foreign.append(input); group.append(foreign);
        } else {
            row!.classList.add('is-editing'); const label = row!.querySelector<HTMLElement>('.cmm-composer-idea-title'); if (label) label.hidden = true;
            row!.prepend(input);
        }
        const resize = () => {
            input.setCssStyles({ height: '0px' });
            const height = Math.max(geometry?.height ?? 32, input.scrollHeight);
            input.setCssStyles({ height: `${height}px` }); foreign?.setAttribute('height', String(height)); box?.setAttribute('height', String(height));
        };
        resize();
        let finished = false;
        this.finishName = (cancel = false) => {
            if (finished) return; finished = true; this.finishName = undefined; this.nameInput = undefined;
            const title = input.value.replace(/[\r\n]+/g, ' ').trim(); input.remove(); foreign?.remove();
            if (!cancel && title) this.change(draft => { this.node(id, draft).title = title; }, `title:${id}`, false);
            this.history.endEdit(cancel || !title); this.editingActive = false;
            // Committing the title of a brand-new node is still part of the same insertion, so it
            // must not pin the new node and drag the scene with it. Naming an existing node keeps
            // the usual pin so it does not drift away under the caret.
            this.render(!fresh);
            if (fresh) this.ensureVisible();
            this.remember();
        };
        input.oninput = resize;
        input.onpaste = event => {
            event.preventDefault(); const text = event.clipboardData?.getData('text/plain').replace(/[\r\n]+/g, ' ') ?? '';
            input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end'); resize();
        };
        for (const type of ['pointerdown', 'click', 'dblclick'] as const) input.addEventListener(type, event => event.stopPropagation());
        const finish = this.finishName;
        input.onblur = () => finish();
        input.onkeydown = event => {
            if (event.isComposing) return;
            if (!['Enter', 'Tab', 'Escape'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); const value = input.value.trim();
            this.finishName?.(event.key === 'Escape'); this.stage.focus();
            if (event.key === 'Tab' && event.shiftKey) this.structure('promote');
            else if (value && event.key === 'Tab') this.add(true);
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
        const modal = new Modal(this.app); modal.titleEl.setText(ids.length > 1 ? ct('Delete {count} selected nodes?', { count: ids.length }) : ct('Delete “{title}”?', { title: this.node().title }));
        this.button(modal.contentEl, ct('Delete this branch'), () => { remove(false); modal.close(); });
        this.button(modal.contentEl, ct('Delete node but keep children'), () => { remove(true); modal.close(); });
        this.button(modal.contentEl, ct('Cancel'), () => modal.close()); modal.open();
    }
    private key(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing) return;
        const target = event.target as HTMLElement;
        if (target === this.nameInput) return;
        const mod = event.metaKey || event.ctrlKey;
        if (target.closest('input, textarea, [contenteditable=true]') && target !== this.body) return;
        if (mod && event.key.toLowerCase() === 'f' && target !== this.body) { event.preventDefault(); this.openSearch(); return; }
        if (mod && event.key === 'Enter') { event.preventDefault(); this.autoPanel = true; this.draft.panel = this.draft.panel === 'hide' ? 'auto' : this.draft.panel; this.applyPanel(); this.body.focus(); return; }
        if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) this.history.redo(); else this.history.undo(); this.render(true); this.ensureVisible(); this.remember(); return; }
        if (event.key === 'F2' && !target.closest('textarea, input, [contenteditable=true]')) { event.preventDefault(); event.stopPropagation(); if (this.selectedNote) this.renameNote(); else this.rename(false); return; }
        if (target.closest('textarea, input, select, button')) { if (event.key === 'Escape' && target === this.body) { event.preventDefault(); this.stage.focus(); } return; }
        if (this.draft.mode === 'sketch' && (event.key === 'Delete' || event.key === 'Backspace') && (this.selectedNote || this.selectedAnnotation || this.selectedLink)) {
            event.preventDefault(); event.stopPropagation();
            this.deleteSketchSelection(); return;
        }
        let handled = true;
        if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) this.structure(({ ArrowLeft: 'promote', ArrowRight: 'demote', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowLeft']);
        else if (event.key === 'Enter') this.add(false);
        else if (event.key === 'Tab') event.shiftKey ? this.structure('promote') : this.add(true);
        else if (event.key === 'Delete' || event.key === 'Backspace') this.deleteNode();
        else if (event.key === '0') this.fit();
        else if (event.key === '+' || event.key === '=') this.zoom(1.18);
        else if (event.key === '-') this.zoom(.85);
        else if (event.key === 'Escape' && this.draft.mode === 'sketch' && (this.linkStart || this.sketchTool !== 'select')) {
            this.linkStart = undefined; this.sketchTool = 'select'; this.updateSketchControls();
        }
        else if (event.key === 'Escape' && this.draft.focusNode) this.focusBranch();
        else if (event.key.startsWith('Arrow')) {
            const all = entries(this.draft, true), current = all.find(e => e.node.id === this.draft.selection)!;
            const visible = this.visibleOrder(), ordered = all.filter(e => visible.includes(e.node.id)); const index = ordered.indexOf(current);
            const next = event.key === 'ArrowLeft' ? current.parent : event.key === 'ArrowRight' ? current.node.children[0] : ordered[index + (event.key === 'ArrowDown' ? 1 : -1)]?.node;
            if (next && visible.includes(next.id)) { this.select(next.id); this.ensureVisible(); }
        } else handled = false;
        if (handled) { event.preventDefault(); event.stopPropagation(); }
    }
    private deleteSketchSelection(): void {
        const noteId = this.selectedNote, annotationId = this.selectedAnnotation, linkId = this.selectedLink;
        this.change(draft => { if (noteId) { draft.sketch!.notes = draft.sketch!.notes.filter(n => n.id !== noteId); draft.sketch!.links = draft.sketch!.links.filter(l => l.from !== noteId && l.to !== noteId); }
            if (annotationId) draft.sketch!.annotations = draft.sketch!.annotations.filter(a => a.id !== annotationId);
            if (linkId) draft.sketch!.links = draft.sketch!.links.filter(l => l.id !== linkId); });
        this.selectedNote = undefined; this.selectedAnnotation = undefined; this.selectedLink = undefined; this.syncBody();
    }
    private idAt(target: EventTarget | null): string | undefined { return (target as Element | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? undefined; }
    private noteAt(target: EventTarget | null): string | undefined { return (target as Element | null)?.closest?.('[data-free-note-id]')?.getAttribute('data-free-note-id') ?? undefined; }
    private canvasPoint(x: number, y: number): { x: number; y: number } {
        const rect = this.svg.getBoundingClientRect(); return { x: (x - rect.left - this.viewport.offset.x) / this.viewport.scale, y: (y - rect.top - this.viewport.offset.y) / this.viewport.scale };
    }
    private updateSketchControls(): void {
        const sketch = this.draft.mode === 'sketch'; this.contentEl.classList.toggle('is-sketch', sketch);
        this.modeButton.textContent = sketch ? ct('Sketch') : ct('Structured');
        this.modeButton.setAttribute('aria-label', ct('Switch Composer mode')); this.modeButton.setAttribute('aria-pressed', String(sketch));
        this.arrangeButton.hidden = !sketch; this.sketchTools.hidden = !sketch;
        this.sketchTools.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === this.sketchTool)));
        const connect = this.sketchTools.querySelector<HTMLButtonElement>('[data-tool="link"]');
        if (connect) connect.textContent = this.linkStart ? ct('Choose target') : ct('Connect');
    }
    private arrangeSketch(): void {
        this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.positions = {}; }); this.fit();
    }
    private createFreeNote(position: { x: number; y: number }, title = ct('New idea'), body = '', sourceIdeaId?: string, rename = true): void {
        const note: FreeNote = { id: sketchId('note'), title, body,
            position: { x: position.x - SKETCH_NOTE_SIZE.width / 2, y: position.y - SKETCH_NOTE_SIZE.height / 2 }, sourceIdeaId };
        if (this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.notes.push(note); })) {
            this.sketchTool = 'select'; this.linkStart = undefined; this.updateSketchControls();
            this.selectNote(note.id); if (rename) this.renameNote();
        }
    }
    private selectNote(id: string): void {
        this.selectedNote = id; this.selectedAnnotation = undefined; this.selectedLink = undefined; this.interacted = true;
        this.scene.querySelectorAll('.cmm-sketch-note').forEach(note => note.classList.toggle('is-selected', note.getAttribute('data-free-note-id') === id));
        this.scene.querySelectorAll('.cmm-organic-node').forEach(node => node.classList.remove('is-selected', 'is-multiselected'));
        this.syncBody(); this.applyPanel(); this.positionContext(); this.stage.focus();
    }
    private renameNote(): void {
        const note = this.draft.sketch?.notes.find(n => n.id === this.selectedNote); if (!note) return;
        this.prompt(ct('Free note'), note.title, title => {
            if (!title.trim()) return false;
            this.change(draft => { const current = draft.sketch?.notes.find(n => n.id === note.id); if (current) current.title = title.trim(); });
        });
    }
    private convertNote(id: string): void {
        const note = this.draft.sketch?.notes.find(n => n.id === id); if (!note) return;
        this.change(draft => {
            const parent = entries(draft).some(e => e.node.id === draft.selection) ? this.node(draft.selection, draft) : draft.root;
            const node = newNode(note.title, 'heading'); node.body = note.body;
            parent.children.push(node); parent.collapsed = false;
            draft.sketch!.positions[node.id] = { ...note.position };
            draft.sketch!.notes = draft.sketch!.notes.filter(n => n.id !== id);
            draft.sketch!.links = draft.sketch!.links.map(l => ({ ...l, from: l.from === id ? node.id : l.from, to: l.to === id ? node.id : l.to }));
            draft.sketch!.annotations = draft.sketch!.annotations.map(mark => mark.anchorId === id ? { ...mark, anchorId: node.id } : mark);
            draft.selection = node.id; draft.selections = [node.id];
        }); this.selectedNote = undefined; this.render();
    }
    private sketchPointer(event: PointerEvent): void {
        if (event.button !== 0 || (event.target as Element).closest('input, textarea, [role=button], [role=checkbox]')) return;
        if (this.sketchTool === 'select') this.suppressSketchClick = false;
        const nodeId = this.idAt(event.target), noteId = this.noteAt(event.target);
        const annotationId = (event.target as Element).closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? undefined;
        const linkId = (event.target as Element).closest('[data-link-id]')?.getAttribute('data-link-id') ?? undefined;
        if (linkId) {
            this.selectedAnnotation = undefined; this.selectedNote = undefined; this.selectedLink = linkId;
            this.scene.querySelectorAll('.cmm-sketch-link').forEach(link => link.classList.toggle('is-selected', link.getAttribute('data-link-id') === linkId));
            this.scene.querySelectorAll('.cmm-sketch-note, .cmm-sketch-annotation').forEach(item => item.classList.remove('is-selected'));
            this.syncBody(); this.positionContext(); this.stage.focus(); return;
        }
        if (annotationId && this.sketchTool === 'select') {
            event.preventDefault();
            this.selectedAnnotation = annotationId; this.selectedNote = undefined; this.selectedLink = undefined;
            this.scene.querySelectorAll('.cmm-sketch-annotation').forEach(item => item.classList.toggle('is-selected', item.getAttribute('data-annotation-id') === annotationId));
            this.scene.querySelectorAll('.cmm-sketch-note, .cmm-sketch-link').forEach(item => item.classList.remove('is-selected'));
            this.scene.querySelectorAll('.cmm-sketch-handle').forEach(item => item.remove());
            const mark = this.draft.sketch?.annotations.find(item => item.id === annotationId);
            if (mark && mark.kind !== 'text') {
                const group = this.scene.querySelector<SVGGElement>(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
                for (const endpoint of ['start', 'end'] as const) {
                    const at = mark[endpoint]; group?.append(svgElement(this.scene.ownerDocument, 'circle', { class: 'cmm-sketch-handle', 'data-endpoint': endpoint, cx: at.x, cy: at.y, r: 5 }));
                }
            }
            this.syncBody(); this.positionContext(); this.stage.focus(); this.dragAnnotation(event, annotationId); return;
        }
        if (this.sketchTool === 'link') {
            const target = noteId ?? nodeId;
            if (target) { event.preventDefault(); event.stopPropagation();
                if (this.linkStart && this.linkStart !== target) { const from = this.linkStart; this.linkStart = undefined;
                    this.change(draft => { draft.sketch ??= emptySketch(); if (!draft.sketch.links.some(l => (l.from === from && l.to === target) || (l.from === target && l.to === from))) draft.sketch.links.push({ id: sketchId('link'), from, to: target }); });
                    this.sketchTool = 'select';
                } else this.linkStart = target; this.updateSketchControls(); }
            return;
        }
        const start = this.canvasPoint(event.clientX, event.clientY);
        if (this.sketchTool !== 'select') {
            event.preventDefault(); event.stopPropagation(); this.suppressSketchClick = true;
            const tool = this.sketchTool, win = this.contentEl.ownerDocument.defaultView!, annotationId = sketchId('annotation');
            const target = noteId ?? nodeId;
            if (target && (tool === 'ellipse' || tool === 'highlight')) {
                const box = noteId ? SKETCH_NOTE_SIZE : this.result?.nodes.find(n => n.id === nodeId);
                if (!box) return;
                const a = tool === 'ellipse' ? { x: -5, y: -5 } : { x: 11, y: box.height * .66 };
                const b = tool === 'ellipse' ? { x: box.width + 5, y: box.height + 5 } : { x: box.width - 11, y: box.height * .66 + 1 };
                this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.annotations.push({ id: annotationId, kind: tool, anchorId: target, start: a, end: b }); });
                this.sketchTool = 'select'; this.updateSketchControls(); return;
            }
            if (target) return;
            const move = (e: PointerEvent) => { if (e.pointerId !== event.pointerId || tool === 'text') return;
                paintSketchPreview(this.scene, { id: annotationId, kind: tool, start, end: this.canvasPoint(e.clientX, e.clientY) }); };
            const end = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; cleanup(); const finish = this.canvasPoint(e.clientX, e.clientY);
                if (tool === 'text') {
                    this.sketchTool = 'select'; this.updateSketchControls();
                    this.prompt(ct('Text note'), '', text => { if (text.trim()) this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.annotations.push({ id: sketchId('annotation'), kind: 'text', start, end: start, text: text.trim() }); }); });
                } else if (Math.hypot(finish.x - start.x, finish.y - start.y) > 8) {
                    this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.annotations.push({ id: annotationId, kind: tool, start, end: finish }); });
                    this.sketchTool = 'select'; this.updateSketchControls();
                } };
            const cleanup = () => { paintSketchPreview(this.scene); win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', cleanup); this.dragCleanup = undefined; };
            this.dragCleanup = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', cleanup); return;
        }
        if (noteId || nodeId) event.preventDefault();
        if (noteId) this.selectNote(noteId);
        else if (nodeId) this.select(nodeId);
        else { this.selectedNote = undefined; this.selectedAnnotation = undefined; this.selectedLink = undefined; this.syncBody(); }
        const initial = nodeId ? this.draft.sketch?.positions[nodeId] ?? this.result?.nodes.find(n => n.id === nodeId) : noteId ? this.draft.sketch?.notes.find(n => n.id === noteId)?.position : undefined;
        if (!initial) { this.pointer(event); return; }
        const origin = { x: initial.x, y: initial.y }, previous = nodeId ? this.draft.sketch?.positions[nodeId] : undefined;
        const win = this.contentEl.ownerDocument.defaultView!; let moved = false, frame = 0;
        const move = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; const dx = (e.clientX - event.clientX) / this.viewport.scale, dy = (e.clientY - event.clientY) / this.viewport.scale;
            if (!moved && Math.hypot(dx, dy) < 5 / this.viewport.scale) return; moved = true; e.preventDefault();
            const position = { x: origin.x + dx, y: origin.y + dy }; this.draft.sketch ??= emptySketch();
            if (nodeId) this.draft.sketch.positions[nodeId] = position;
            else { const note = this.draft.sketch.notes.find(n => n.id === noteId); if (note) note.position = position; }
            if (nodeId) { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; this.render(); }); }
            else if (noteId && this.result) paintSketchNoteMove(this.scene, this.result, this.draft.sketch, noteId);
        };
        const cleanup = () => { win.cancelAnimationFrame(frame); win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', cancel); this.dragCleanup = undefined; };
        const cancel = () => { cleanup(); if (nodeId) { if (previous) this.draft.sketch!.positions[nodeId] = previous; else if (this.draft.sketch) delete this.draft.sketch.positions[nodeId]; } else { const note = this.draft.sketch?.notes.find(n => n.id === noteId); if (note) note.position = origin; } this.render(); };
        const end = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; cleanup(); if (!moved) return;
            // The drag wrote the live position; fall back to where the pointer left it.
            const position: { x: number; y: number } | undefined = nodeId ? this.draft.sketch?.positions[nodeId] : this.draft.sketch?.notes.find(n => n.id === noteId)?.position;
            if (!position) return;
            if (nodeId) { if (previous) this.draft.sketch!.positions[nodeId] = previous; else delete this.draft.sketch!.positions[nodeId]; this.change(draft => { draft.sketch ??= emptySketch(); draft.sketch.positions[nodeId] = position; }, '', false); }
            else { const note = this.draft.sketch?.notes.find(n => n.id === noteId); if (note) note.position = origin; this.change(draft => { const target = draft.sketch?.notes.find(n => n.id === noteId); if (target) target.position = position; }, '', false); }
            this.render(); this.remember(); };
        this.dragCleanup = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', cancel);
    }
    private dragAnnotation(event: PointerEvent, id: string): void {
        const mark = this.draft.sketch?.annotations.find(a => a.id === id); if (!mark) return;
        const start = { ...mark.start }, finish = { ...mark.end }, win = this.contentEl.ownerDocument.defaultView!;
        const endpoint = (event.target as Element).closest('[data-endpoint]')?.getAttribute('data-endpoint');
        let moved = false, frame = 0;
        const move = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return;
            const dx = (e.clientX - event.clientX) / this.viewport.scale, dy = (e.clientY - event.clientY) / this.viewport.scale;
            if (!moved && Math.hypot(dx, dy) < 5 / this.viewport.scale) return; moved = true;
            const current = this.draft.sketch?.annotations.find(a => a.id === id); if (!current) return;
            if (endpoint !== 'end') current.start = { x: start.x + dx, y: start.y + dy };
            if (endpoint !== 'start') current.end = { x: finish.x + dx, y: finish.y + dy };
            if (endpoint) { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; this.render(); }); }
            else this.scene.querySelector<SVGGElement>(`[data-annotation-id="${CSS.escape(id)}"]`)?.setAttribute('transform', `translate(${dx} ${dy})`); };
        const cleanup = () => { win.cancelAnimationFrame(frame); win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', cancel); this.dragCleanup = undefined; };
        const cancel = () => { cleanup(); const current = this.draft.sketch?.annotations.find(a => a.id === id); if (current) { current.start = start; current.end = finish; } this.render(); };
        const end = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; cleanup(); if (!moved) return;
            const current = this.draft.sketch?.annotations.find(a => a.id === id); if (!current) return;
            const destination = { start: current.start, end: current.end }; current.start = start; current.end = finish;
            this.change(draft => { const target = draft.sketch?.annotations.find(a => a.id === id); if (target) Object.assign(target, destination); }); };
        this.dragCleanup = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', cancel);
    }
    private pointer(event: PointerEvent): void {
        if (event.button !== 0 || (event.target as Element).closest('input, textarea, [role="button"], [role="checkbox"], .cmm-composer-idea-fold')) return;
        this.finishName?.(); this.dragCleanup?.();
        const id = this.idAt(event.target), start = { x: event.clientX, y: event.clientY }; let last = start, moved = false;
        const ids = id && this.selected.includes(id) ? this.selected : id ? [id] : [];
        let drop: (DropHit & { valid: boolean }) | undefined, frame = 0, hoverSince = 0;
        const validation = new Map<string, string>(); const sourceDraft = this.draft;
        const preview = this.contentEl.createDiv({ cls: 'cmm-composer-drop', attr: { role: 'status', 'aria-live': 'polite' } }); preview.hidden = true;
        const ghost = this.contentEl.createDiv({ cls: 'cmm-composer-drag-ghost' }); ghost.hidden = true;
        const win = this.contentEl.ownerDocument.defaultView!;
        const clear = () => this.contentEl.querySelectorAll('.is-drop-child, .is-drop-invalid').forEach(el => el.classList.remove('is-drop-child', 'is-drop-invalid'));
        const feedback = () => {
            clear();
            const targets: DropTarget[] = [];
            const elements = new Map<string, Element>();
            const surface = this.contentEl.ownerDocument.elementFromPoint(last.x, last.y);
            // Controls and the body editor never become drop targets through a nearby node.
            const blocked = surface?.closest('textarea, input, .cmm-composer-body, .cmm-composer-toolbar, .cmm-composer-context, .cmm-composer-body-preview, [role=button], [role=checkbox]');
            const addTarget = (el: Element, inbox: boolean) => {
                const key = el.getAttribute('data-node-id')!;
                if (inbox && el.getAttribute('data-inbox-root') !== key) return;
                const rect = (inbox ? el : el.querySelector('.cmm-organic-hitbox') ?? el).getBoundingClientRect();
                let bottom = rect.bottom;
                if (inbox) for (const row of Array.from(this.drawerList.children)) {
                    if (row.getAttribute('data-inbox-root') === key) bottom = Math.max(bottom, row.getBoundingClientRect().bottom);
                }
                const bounds = (inbox ? this.drawerList : this.svg).getBoundingClientRect();
                if (bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) return;
                targets.push({ id: key, inbox, rect: { left: Math.max(rect.left, bounds.left), right: Math.min(rect.right, bounds.right), top: Math.max(rect.top, bounds.top), bottom: Math.min(bottom, bounds.bottom) } }); elements.set(key, el);
            };
            this.scene.querySelectorAll('[data-node-id]').forEach(el => addTarget(el, false));
            if (this.drawerOpen) {
                this.drawerList.querySelectorAll('[data-node-id]').forEach(el => addTarget(el, true));
                targets.push({ id: '@unsorted', inbox: true, rect: this.drawerList.getBoundingClientRect() }); elements.set('@unsorted', this.drawerList);
            }
            // A source or descendant is an explicit invalid target, never a route to an old valid one.
            const hit = blocked ? undefined : hitDrop(last.x, last.y, targets, drop);
            drop = undefined; preview.hidden = true;
            preview.removeAttribute('data-position'); preview.removeAttribute('data-target'); preview.removeAttribute('data-valid');
            ghost.hidden = false; ghost.textContent = `${selectedRoots(this.draft, ids).length || 1} · ${this.node(id).title || ct('New idea')}`;
            ghost.setCssStyles({ left: `${last.x + 16}px`, top: `${last.y + 16}px` });
            if (!hit) return;
            if (sourceDraft !== this.draft) validation.clear();
            const cacheKey = `${hit.target}:${hit.position}`;
            let reason = validation.get(cacheKey);
            if (reason === undefined) { reason = ''; try { transferNodes(clone(this.draft), ids, hit); } catch (error) { reason = ct((error as Error).message); } validation.set(cacheKey, reason); }
            drop = { ...hit, valid: !reason };
            const target = elements.get(hit.target)!, rect = targets.find(t => t.id === hit.target)!.rect;
            preview.dataset.position = hit.position; preview.dataset.target = hit.target; preview.dataset.valid = String(!reason);
            preview.textContent = reason; preview.setAttribute('aria-label', reason || ({ before: ct('Insert before'), child: ct('Make child'), after: ct('Insert after') })[hit.position]);
            preview.classList.toggle('is-invalid', !!reason);
            if (reason || hit.position === 'child') {
                target.classList.add(reason ? 'is-drop-invalid' : 'is-drop-child');
                if (reason) { preview.hidden = false; preview.setCssStyles({ left: `${last.x + 12}px`, top: `${last.y + 40}px`, width: '' }); }
            } else {
                preview.hidden = false; preview.setCssStyles({ left: `${rect.left}px`, top: `${(hit.position === 'before' ? rect.top : rect.bottom) - 1}px`, width: `${rect.right - rect.left}px` });
            }
        };
        const tick = () => {
            if (!moved || !id) return;
            const entry = this.ideasButton.getBoundingClientRect();
            const overEntry = last.x >= entry.left && last.x <= entry.right && last.y >= entry.top && last.y <= entry.bottom;
            if (!this.drawerOpen && overEntry) {
                if (!hoverSince) hoverSince = performance.now();
                if (performance.now() - hoverSince >= 400) { this.drawerOpen = true; this.renderDrawer(); }
            } else hoverSince = 0;
            const edgeSpeed = (value: number, min: number, max: number) => value < min + 32 ? -Math.min(8, (min + 32 - value) / 4) : value > max - 32 ? Math.min(8, (value - max + 32) / 4) : 0;
            const inbox = this.drawerList.getBoundingClientRect(), canvas = this.svg.getBoundingClientRect();
            if (this.drawerOpen && last.x >= inbox.left && last.x <= inbox.right && last.y >= inbox.top && last.y <= inbox.bottom) this.drawerList.scrollTop += edgeSpeed(last.y, inbox.top, inbox.bottom);
            else if (last.x >= canvas.left && last.x <= canvas.right && last.y >= canvas.top && last.y <= canvas.bottom) {
                this.viewport.pan(-edgeSpeed(last.x, canvas.left, canvas.right), -edgeSpeed(last.y, canvas.top, canvas.bottom)); this.transform();
            }
            feedback(); frame = win.requestAnimationFrame(tick);
        };
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
            const first = !moved; moved = true; e.preventDefault();
            if (!id) this.viewport.pan(e.clientX - last.x, e.clientY - last.y);
            last = { x: e.clientX, y: e.clientY }; this.transform();
            if (id) { feedback(); if (first) { this.contentEl.classList.add('is-dragging'); frame = win.requestAnimationFrame(tick); } }
        };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); } };
        const cleanup = () => {
            win.cancelAnimationFrame(frame); clear(); this.contentEl.classList.remove('is-dragging');
            win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', cancel); win.removeEventListener('blur', cancel); win.removeEventListener('keydown', escape, true);
            preview.remove(); ghost.remove(); this.dragCleanup = undefined;
            if (moved) {
                const suppress = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
                this.contentEl.addEventListener('click', suppress, { capture: true, once: true });
                win.setTimeout(() => this.contentEl.removeEventListener('click', suppress, true), 0);
            }
        };
        const cancel = () => cleanup();
        const end = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            last = { x: e.clientX, y: e.clientY }; if (moved && id) feedback();
            cleanup();
            if (moved && id && drop?.valid) { const destination = drop; this.change(draft => { transferNodes(draft, ids, destination); draft.selection = id; draft.selections = ids; }); this.ensureVisible(); this.stage.focus(); }
            if (!id && !moved) { this.autoPanel = false; this.applyPanel(); this.stage.focus(); }
            this.remember();
        };
        this.dragCleanup = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', cancel); win.addEventListener('blur', cancel); win.addEventListener('keydown', escape, true);
    }
    private openBody(): void { this.autoPanel = true; if (this.draft.panel === 'hide') this.draft.panel = 'auto'; this.applyPanel(); this.body.focus(); this.remember(); }
    private positionContext(): void {
        if (!this.contextBar) return;
        const node = this.result?.nodes.find(n => n.id === this.draft.selection);
        this.contextBar.hidden = !node || !this.interacted || !!this.nameInput || !!this.selectedNote || !!this.selectedAnnotation || !!this.selectedLink;
        if (this.emptyHint) this.emptyHint.hidden = !!this.draft.root.children.length || this.interacted;
        if (!node) return;
        const x = node.x * this.viewport.scale + this.viewport.offset.x;
        const y = (node.y + node.height) * this.viewport.scale + this.viewport.offset.y;
        this.contextBar.setCssStyles({ left: Math.max(8, Math.min(x, this.stage.clientWidth - this.contextBar.offsetWidth - 8)) + 'px',
            top: Math.max(8, Math.min(y + 12, this.stage.clientHeight - 48)) + 'px' });
        if (this.emptyHint) this.emptyHint.setCssStyles({ left: (x + node.width * this.viewport.scale / 2) + 'px', top: (y + 16) + 'px' });
    }
    private viewMenu(event: MouseEvent): void {
        const menu = new Menu();
        const section = (title: string, build: (child: Menu) => void) => menu.addItem(item => {
            item.setTitle(title); const entry = item as typeof item & { setSubmenu?: () => Menu };
            if (entry.setSubmenu) build(entry.setSubmenu()); else { item.setDisabled(true); build(menu); }
        });
        section(ct('Layout'), menu => {
        for (const [value, title] of [['organic-radial', ct('Radial')], ['organic-horizontal', ct('Horizontal')], ['compact-organic', ct('Compact')]] as const)
            menu.addItem(item => item.setTitle(title).setChecked(this.draft.layout === value).onClick(() => { this.draft.layout = value; this.render(); this.fit(); this.remember(); }));
        });
        section(ct('Body'), menu => {
        for (const value of ['auto', 'show', 'hide'] as const) menu.addItem(item => item.setTitle(ct((value[0] ?? '').toUpperCase() + value.slice(1))).setChecked(this.draft.panel === value).onClick(() => { this.draft.panel = value; this.autoPanel = false; this.applyPanel(); this.remember(); }));
        });
        menu.addSeparator();
        menu.addItem(item => item.setTitle(ct('Fit to view')).onClick(() => this.fit()));
        menu.addItem(item => item.setTitle(ct('Reset zoom')).onClick(() => this.zoom(1 / this.viewport.scale)));
        menu.showAtMouseEvent(event);
    }
    private nodeMenu(event: MouseEvent): void {
        const menu = new Menu();
        menu.addItem(item => item.setTitle(ct('Rename')).onClick(() => this.rename(false)));
        menu.addItem(item => item.setTitle(ct('Edit body')).onClick(() => { this.openBody(); }));
        const submenu = (label: string, build: (menu: Menu) => void) => menu.addItem(item => {
            item.setTitle(label); const supported = item as typeof item & { setSubmenu?: () => Menu };
            if (supported.setSubmenu) build(supported.setSubmenu()); else { item.setDisabled(true); build(menu); }
        });
        menu.addItem(item => item.setTitle(ct('Create parent from selection')).onClick(() => this.groupSelection()));
        menu.addItem(item => item.setTitle(ct('Duplicate')).setDisabled(this.selected.includes(this.draft.root.id)).onClick(() => {
            const ids = this.selected;
            this.change(draft => {
                const copies: string[] = [];
                const copy = (node: ComposerNode): ComposerNode => ({ ...clone(node), id: newNode().id, children: node.children.map(copy) });
                for (const entry of selectedRoots(draft, ids)) { const node = copy(entry.node), siblings = siblingsOf(draft, entry.node.id); siblings.splice(siblings.indexOf(entry.node) + 1, 0, node); copies.push(node.id); }
                if (copies.length) { draft.selection = copies[0] ?? draft.selection; draft.selections = copies; }
            });
        }));
        submenu(ct('Branch'), menu => {
            menu.addItem(item => item.setTitle(ct('Focus branch')).onClick(() => this.focusBranch(this.draft.selection)));
            menu.addItem(item => item.setTitle(ct('Show overview')).onClick(() => this.focusBranch(this.draft.root.id)));
            for (const [action, title] of [['one', ct('Expand one level')], ['expand', ct('Expand branch')], ['collapse', ct('Collapse branch')]] as const)
                menu.addItem(item => item.setTitle(title).onClick(() => this.foldBranch(action)));
            menu.addItem(item => item.setTitle(ct('Show to level…')).onClick(() => this.prompt(ct('Show branch to level (1–6)'), '2', value => {
                const level = Number(value); if (!Number.isInteger(level) || level < 1 || level > 6) { new Notice(ct('Choose a level from 1 to 6.')); return false; } this.foldBranch('level', level);
            })));
        });
        submenu(ct('Node type'), menu => {
            for (const type of ['heading', 'idea', 'todo'] as const) menu.addItem(item => item.setTitle(type === 'heading' ? ct('Heading') : type === 'idea' ? ct('Idea') : ct('Todo')).setChecked(this.node().type === type).onClick(() => this.changeType(type)));
        });
        menu.addSeparator(); menu.addItem(item => item.setTitle(ct('Delete')).onClick(() => this.deleteNode())); menu.showAtMouseEvent(event);
    }
    private documentMenu(event: MouseEvent): void {
        const menu = new Menu();
        const item = (title: string, action: () => unknown) =>
            menu.addItem(entry => entry.setTitle(title).onClick(() => { void action(); }));
        // Grouped rather than one flat list of thirteen entries: the primary action and the
        // draft-lifecycle commands stay at the top level because they are used every session.
        const section = (title: string, build: (target: Menu) => void) => menu.addItem(entry => {
            entry.setTitle(title);
            const nested = entry as typeof entry & { setSubmenu?: () => Menu };
            // Older Obsidian builds lack submenus; fall back to flattening rather than hiding items.
            if (nested.setSubmenu) build(nested.setSubmenu());
            else build(menu);
        });

        section(ct('Document'), target => {
            target.addItem(entry => entry.setTitle(ct('Rename document')).onClick(() => { this.select(this.draft.root.id); this.rename(false); }));
            target.addItem(entry => entry.setTitle(ct('Edit introduction')).onClick(() => { this.select(this.draft.root.id); this.openBody(); }));
            target.addItem(entry => entry.setTitle(ct('Add top-level section')).onClick(() => { this.select(this.draft.root.id); this.add(true); }));
            target.addItem(entry => entry.setTitle(ct('Use root as H1'))
                .setChecked(this.draft.rootAsHeading).onClick(() => this.change(draft => { draft.rootAsHeading = !draft.rootAsHeading; })));
        });
        section(ct('Metadata and info'), target => {
            target.addItem(entry => entry.setTitle(ct('Document properties')).onClick(() => this.documentProperties()));
            target.addItem(entry => entry.setTitle(ct('Document Info')).onClick(() => {
                const modal = new Modal(this.app); modal.titleEl.setText(ct('Document Info'));
                for (const [key, value] of Object.entries(draftStatistics(this.draft))) modal.contentEl.createEl('p', { text: `${ct(key)}: ${value}` });
                modal.open();
            }));
        });
        section(ct('Drafts'), target => {
            target.addItem(entry => entry.setTitle(ct('New from template')).onClick(() =>
                showTemplates(this.app, draft => { void this.openDraft({ ...draft, ...this.store.preferences }); }, this.draft.targetFolder)));
            target.addItem(entry => entry.setTitle(ct('Duplicate draft')).onClick(() => { this.finishName?.(); void this.openDraft(duplicateDraft(this.draft)); }));
            target.addItem(entry => entry.setTitle(ct('Copy outline')).onClick(() => this.copyOutline()));
        });
        section(ct('Saving and recovery'), target => {
            target.addItem(entry => entry.setTitle(ct('Retry draft save')).onClick(() => { void this.store.flush().catch(() => this.recovery()); }));
            target.addItem(entry => entry.setTitle(ct('Copy recovery data')).onClick(() => this.recovery()));
        });

        menu.addSeparator();
        item(ct('Create Markdown Note'), () => this.createNote());
        // Destructive actions are separated from the routine ones.
        menu.addSeparator(); item(ct('Discard draft'), () => {
            const modal = new Modal(this.app); modal.titleEl.setText(ct('Discard “{title}”?', { title: this.draft.root.title }));
            modal.contentEl.createEl('p', { text: ct('This draft has not been converted to a Markdown note.') });
            this.button(modal.contentEl, ct('Cancel'), () => modal.close());
            this.button(modal.contentEl, ct('Discard'), () => { void (async () => { try { this.finishName?.(); await this.store.remove(this.draft.draftId); this.initialized = false; modal.close(); this.leaf.detach(); } catch { this.recovery(); } })(); }); modal.open();
        });
        menu.showAtMouseEvent(event);
    }
    private recovery(): void {
        const modal = new Modal(this.app); modal.titleEl.setText(ct('Draft recovery'));
        modal.contentEl.createEl('p', { text: ct('Draft storage could not be confirmed. Copy this recovery data before closing Obsidian, or retry saving.') });
        const text = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-recovery' }); text.value = JSON.stringify(this.draft, null, 2); text.readOnly = true;
        this.button(modal.contentEl, ct('Select recovery data'), () => { text.focus(); text.select(); });
        this.button(modal.contentEl, ct('Retry save'), () => { this.store.put(this.draft); void this.store.flush().then(() => modal.close()).catch(() => {}); }); modal.open();
    }
    private createNote(): void {
        this.finishName?.(); if (this.creating) return;
        const modal = new Modal(this.app); modal.titleEl.setText(ct('Create Markdown Note'));
        modal.contentEl.addClass('cmm-composer-create-modal');
        const destination = modal.contentEl.createDiv({ cls: 'cmm-composer-create-section' });
        destination.createEl('h3', { text: ct('Destination') });
        const label = (parent: HTMLElement, text: string) => parent.createEl('label', { cls: 'cmm-composer-field', text });
        const name = label(destination, ct('Name')).createEl('input', { value: this.draft.root.title });
        const location = label(destination, ct('Location (existing vault folder)')).createEl('select', { attr: { 'aria-label': ct('Location (existing vault folder)') } });
        location.createEl('option', { value: '', text: ct('Vault root') });
        const initialFolder = this.draft.targetFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const folders = this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path !== '/');
        folders.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
        for (const folder of folders) location.createEl('option', { value: folder.path, text: folder.path });
        if (initialFolder && !folders.some(folder => folder.path === initialFolder)) {
            const missing = location.createEl('option', { value: initialFolder, text: ct('Folder no longer exists: {path}', { path: initialFolder }) });
            missing.disabled = true;
        }
        location.value = initialFolder;
        const pathPreview = destination.createDiv({ cls: 'cmm-composer-create-path', attr: { 'aria-live': 'polite' } });
        const updatePath = () => { try { if (location.selectedOptions[0]?.disabled) throw new Error(); pathPreview.textContent = ct('New note: {path}', { path: notePath(name.value, location.value) }); }
            catch { pathPreview.textContent = ct('Enter a valid name and folder to see the note path.'); } };
        name.addEventListener('input', updatePath); location.addEventListener('change', updatePath); updatePath();
        const content = modal.contentEl.createDiv({ cls: 'cmm-composer-create-section' });
        content.createEl('h3', { text: ct('Content') });
        const root = label(content, ct('Root behavior')).createEl('select'); root.createEl('option', { value: 'no', text: ct('Document name only') }); root.createEl('option', { value: 'yes', text: ct('Use root as H1') }); root.value = this.draft.rootAsHeading ? 'yes' : 'no';
        const stats = draftStatistics(this.draft);
        content.createDiv({ cls: 'cmm-composer-create-summary', text: ct('This draft has {count} sections.', { count: stats.sections }) });
        const ideasLabel = label(content, ct('This draft contains {count} idea nodes. Export ideas as', { count: stats.ideas }));
        const ideas = ideasLabel.createEl('select', { attr: { 'aria-label': ct('Idea export policy') } });
        for (const [value, text] of [['', ct('Choose…')], ['headings', ct('Convert to headings')], ['bullets', ct('Convert to bullet items')], ['exclude', ct('Exclude idea branches')], ['review', ct('Review individually')]]) ideas.createEl('option', { value, text });
        ideasLabel.hidden = stats.ideas === 0;
        ideas.onchange = () => { if (ideas.value === 'review') { modal.close(); this.reviewIdeas(); } else refreshPreview(); };
        const unsortedLabel = label(content, ct('{count} nodes in Unsorted Ideas', { count: stats.unsorted }));
        const unsorted = unsortedLabel.createEl('select', { attr: { 'aria-label': ct('Unsorted export policy') } });
        for (const [value, text] of [['', ct('Choose…')], ['append', ct('Append to document')], ['exclude', ct('Exclude and keep draft')]]) unsorted.createEl('option', { value, text });
        unsortedLabel.hidden = !stats.unsorted;
        if (stats.ideas || stats.unsorted) content.createEl('p', { cls: 'cmm-composer-create-help', text: ct('Excluded branches remain in a saved draft after creation. Bullet and Todo branches become lists, including their descendants and bodies.') });
        const empty = label(content, ct('Create an empty Markdown note if there are no sections')); const confirmEmpty = empty.createEl('input', { type: 'checkbox' }); empty.hidden = this.draft.root.children.length > 0;
        const error = modal.contentEl.createEl('p', { attr: { role: 'alert' } });
        const prepare = () => {
            const snapshot = clone(this.draft); snapshot.rootAsHeading = root.value === 'yes'; snapshot.targetFolder = location.value; validateProperties(snapshot.frontmatter ?? '');
            const options: ComposerExportOptions = { ideas: ideas.value && ideas.value !== 'review' ? ideas.value as ComposerExportOptions['ideas'] : undefined,
                unsorted: unsorted.value ? unsorted.value as ComposerExportOptions['unsorted'] : undefined };
            return { snapshot, generated: exportMarkdown(snapshot, options) };
        };
        const preview = modal.contentEl.createEl('textarea', { cls: 'cmm-composer-markdown-preview', attr: { 'aria-label': ct('Markdown preview') } }); preview.readOnly = true; preview.hidden = true;
        const refreshPreview = () => { if (preview.hidden) return; try { preview.value = prepare().generated.text; error.textContent = ''; } catch (failure) { preview.value = ''; error.textContent = ct((failure as Error).message); } };
        const footer = modal.contentEl.createDiv({ cls: 'cmm-composer-create-actions' });
        this.button(footer, ct('Preview Markdown'), () => { preview.hidden = !preview.hidden; refreshPreview(); });
        root.onchange = refreshPreview; unsorted.onchange = refreshPreview;
        const existing = this.button(footer, ct('Open existing note'), () => { try { const file = this.app.vault.getAbstractFileByPath(notePath(name.value, location.value)); if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file); } catch {} }); existing.hidden = true;
        this.button(footer, ct('Cancel'), () => modal.close());
        const create = this.button(footer, ct('Create'), () => { void (async () => {
            if (this.creating || this.closed) return; this.creating = true; create.disabled = true; error.textContent = ''; existing.hidden = true;
            try {
                const { snapshot, generated } = prepare();
                if (!generated.text.trim() && !confirmEmpty.checked) { empty.hidden = false; throw new Error(ct('This mind map has no document sections. Confirm creation of an empty note.')); }
                const path = notePath(name.value, location.value), folder = location.value;
                const selectedFolder = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
                if (!(selectedFolder instanceof TFolder)) throw new Error(ct('Choose an existing vault folder.'));
                const prior = this.app.vault.getAbstractFileByPath(path);
                if (prior && !(snapshot.createdPath === path && prior instanceof TFile && await this.app.vault.read(prior) === generated.text)) {
                    existing.hidden = !(prior instanceof TFile); throw new Error(ct('A note with this name already exists. Choose another name or open the existing note.'));
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
                    throw new Error(ct('Created {path}, but Organic Edit could not be initialized. Your draft is retained in Restore Composer Draft.', { path }));
                const hasCanvasObjects = !!(snapshot.sketch?.notes.length || snapshot.sketch?.links.length || snapshot.sketch?.annotations.length);
                if (!generated.omitted && !hasCanvasObjects) await this.store.remove(snapshot.draftId);
                modal.close(); new Notice(`${ct('Created {path}', { path })}${generated.omitted || hasCanvasObjects ? ct(' · Composer draft retained with canvas ideas.') : ''}`);
            } catch (failure) { error.textContent = ct((failure as Error).message); }
            finally { this.creating = false; create.disabled = false; }
        })(); }); create.addClass('mod-cta'); modal.open(); if (this.draft.root.title === ct('Untitled')) { name.focus(); name.select(); }
    }
    private reviewIdeas(): void {
        const modal = new Modal(this.app); modal.titleEl.setText(ct('Review idea nodes'));
        modal.contentEl.createEl('p', { text: ct('Convert individual ideas to headings or todos, or open a node to edit it. Then create the note again.') });
        for (const { node, unsorted } of entries(this.draft, true).filter(e => e.node.type === 'idea')) {
            const row = modal.contentEl.createDiv({ cls: 'cmm-composer-draft-row' });
            this.button(row, `${unsorted ? ct('Unsorted / ') : ''}${node.title}`, () => { modal.close(); if (unsorted) this.drawerOpen = true; this.select(node.id); this.ensureVisible(); });
            const type = row.createEl('select', { attr: { 'aria-label': ct('Type for {title}', { title: node.title }) } });
            for (const value of ['idea', 'heading', 'todo']) type.createEl('option', { value, text: ct((value[0] ?? '').toUpperCase() + value.slice(1)) });
            type.onchange = () => this.change(draft => { this.node(node.id, draft).type = type.value as ComposerNode['type']; });
        }
        this.button(modal.contentEl, ct('Back to Create Note'), () => { modal.close(); this.createNote(); }); modal.open();
    }
}

function validateProperties(value: string): void {
    if (!value.trim()) return;
    if (/^(---|\.\.\.)\s*$/m.test(value)) throw new Error(ct('Enter YAML without --- delimiters.'));
    const properties: unknown = parseYaml(value);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error(ct('Document properties must be a YAML mapping, such as tags: [research].'));
}

export function showTemplates(app: App, accept: (draft: ComposerDraft) => void, folder = ''): void {
    const modal = new Modal(app); modal.titleEl.setText(ct('New Composer from template'));
    for (const [key, template] of Object.entries(COMPOSER_TEMPLATES)) {
        const button = modal.contentEl.createEl('button', { text: key === 'blank' ? ct('Blank') : ct(template.title), cls: 'cmm-composer-template' });
        button.onclick = () => { accept(fromTemplate(key, folder)); modal.close(); };
    }
    modal.open();
}

export function showDrafts(app: App, store: ComposerStore, open: (id: string) => Promise<void>): void {
    const modal = new Modal(app); modal.titleEl.setText(ct('Restore Composer Draft'));
    const drafts = Object.values(store.data).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!drafts.length) modal.contentEl.createEl('p', { text: ct('No unfinished drafts.') });
    for (const draft of drafts) {
        const row = modal.contentEl.createDiv({ cls: 'cmm-composer-draft-row' });
        const button = row.createEl('button', { text: draft.root.title || ct('Untitled') });
        button.onclick = () => { void open(draft.draftId); modal.close(); };
        row.createEl('small', { text: new Date(draft.updatedAt).toLocaleString() });
        const rename = row.createEl('button', { text: ct('Rename') });
        rename.onclick = () => {
            const editor = new Modal(app); editor.titleEl.setText(ct('Rename draft'));
            const title = editor.contentEl.createEl('input', { value: store.data[draft.draftId]?.root.title ?? draft.root.title, attr: { 'aria-label': ct('Draft name') } });
            const save = editor.contentEl.createEl('button', { text: ct('Save') });
            save.onclick = () => { void (async () => {
                if (!title.value.trim()) return;
                const active = app.workspace.getLeavesOfType(COMPOSER_VIEW).find(leaf => leaf.view.getState().draftId === draft.draftId)?.view as ComposerView | undefined;
                if (active) active.renameDocument(title.value.trim());
                else { const saved = store.data[draft.draftId]; if (!saved) return; const current = clone(saved); current.root.title = title.value.trim(); current.updatedAt = Date.now(); store.put(current); }
                try { await store.flush(); button.textContent = title.value.trim(); editor.close(); } catch (error) { new Notice(String(error)); }
            })(); }; editor.open(); title.focus(); title.select();
        };
        const duplicate = row.createEl('button', { text: ct('Duplicate') });
        duplicate.onclick = () => { void (async () => {
            try { const source = store.data[draft.draftId]; if (!source) return; const copy = duplicateDraft(source); store.put(copy); await store.flush(); await open(copy.draftId); modal.close(); }
            catch (error) { new Notice(String(error)); }
        })(); };
        const remove = row.createEl('button', { text: ct('Delete') });
        remove.onclick = () => {
            if (app.workspace.getLeavesOfType(COMPOSER_VIEW).some(leaf => leaf.view.getState().draftId === draft.draftId)) { new Notice(ct('Close this draft tab first, or use Discard draft in its document menu.')); return; }
            const confirm = new Modal(app); confirm.titleEl.setText(ct('Discard “{title}”?', { title: store.data[draft.draftId]?.root.title ?? draft.root.title }));
            confirm.contentEl.createEl('p', { text: ct('This removes the saved draft, including unsorted ideas.') });
            const cancel = confirm.contentEl.createEl('button', { text: ct('Cancel') }); cancel.onclick = () => confirm.close();
            const discard = confirm.contentEl.createEl('button', { text: ct('Discard') });
            discard.onclick = () => { void store.remove(draft.draftId).then(() => { row.remove(); confirm.close(); }).catch(error => new Notice(String(error))); }; confirm.open();
        };
    }
    const recovery = modal.contentEl.createEl('details'); recovery.createEl('summary', { text: ct('Restore from recovery data') });
    const input = recovery.createEl('textarea', { cls: 'cmm-composer-recovery', attr: { 'aria-label': ct('Paste draft recovery JSON') } });
    const restore = recovery.createEl('button', { text: ct('Restore as a new draft') });
    restore.onclick = () => { void (async () => {
        try { const draft = normalizeDraft(JSON.parse(input.value)); draft.draftId = newDraft().draftId; draft.updatedAt = Date.now(); delete draft.createdPath;
            store.put(draft); await store.flush(); await open(draft.draftId); modal.close();
        } catch (error) { new Notice(ct((error as Error).message)); }
    })(); };
    modal.open();
}
