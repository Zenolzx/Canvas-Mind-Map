import { Component, ItemView, MarkdownRenderer, Menu, Notice, Scope, TFile, WorkspaceLeaf } from 'obsidian';
import { buildMindMapModel, MindMapModel } from '../core/MindMapModel';
import { t } from '../i18n';
import { OrganicLayoutEngine, OrganicLayoutResult } from './OrganicLayoutEngine';
import { OrganicMindMapRenderer, svgElement } from './OrganicMindMapRenderer';
import { OrganicViewState, SavedOrganicState, sourceFingerprint } from './OrganicViewState';
import { OrganicViewportController } from './OrganicViewportController';
import type { OrganicStateStore } from './OrganicStateStore';
import { normalizeOrganicSettings, OrganicSettings } from '../settings';
import { OrganicAutoRefreshController } from './OrganicAutoRefreshController';
import { OrganicIdentity, reconcileOrganicModel } from './OrganicNodeIdentity';
import { OrganicInteractionController } from './OrganicInteractionController';
import { OrganicToolbar } from './OrganicToolbar';
import { OrganicExportService } from './OrganicExportService';
import { DocumentStructure, DocumentStructureParser, projectDocumentMindMap, DOCUMENT_ROOT } from '../document';
import { MindMapWritingController, countWritingWords } from '../writing/MindMapWritingController';
import { ObsidianDocumentHost } from '../writing/ObsidianDocumentHost';
import { captureWritingView, restoreWritingView } from '../writing/WritingViewSnapshot';

export const ORGANIC_VIEW = 'canvas-mind-map-organic';

/** View lifecycle and orchestration; source and reading state never enter Canvas data. */
export class OrganicMindMapView extends ItemView {
    private file?: TFile;
    private sourceText = '';
    private sourceLeaf?: WorkspaceLeaf;
    private model?: MindMapModel;
    private result?: OrganicLayoutResult;
    private state = new OrganicViewState();
    private stateOwner = {};
    private interaction = new OrganicInteractionController(this.state);
    private toolbar?: OrganicToolbar;
    private exporting = false;
    private viewport = new OrganicViewportController();
    private sourcePath?: string;
    private fingerprint = '';
    private identities: OrganicIdentity[] = [];
    private autoRefresh?: OrganicAutoRefreshController;
    private transformFrame?: number;
    private resizeObserver?: ResizeObserver;
    private layoutEpoch = 0;
    private layoutKey = '';
    private searchViewport?: SavedOrganicState['viewport'];
    private get collapsed() { return this.state.collapsed; }
    private set collapsed(value: Set<string>) { this.state.collapsed = value; }
    private svg!: SVGSVGElement;
    private scene!: SVGGElement;
    private status!: HTMLElement;
    private get scale() { return this.viewport.scale; }
    private set scale(value: number) { this.viewport.scale = value; }
    private get offset() { return this.viewport.offset; }
    private set offset(value: { x: number; y: number }) { this.viewport.offset = value; }
    private revision = 0;
    private closed = false;
    private measure!: (text: string, size: number, weight: number) => number;
    private renderer = new OrganicMindMapRenderer();
    private engine = new OrganicLayoutEngine();
    private writing?: MindMapWritingController;
    private writingLayout?: HTMLElement;
    private editorPane?: HTMLElement;
    private readerPane?: HTMLElement;
    private readerComponent?: Component;
    private readerDocument?: DocumentStructure;
    private readerKey = '';
    private readerVisible = false;
    private readerButton?: HTMLButtonElement;
    private modeButton?: HTMLButtonElement;
    private viewModeButton?: HTMLButtonElement;
    private splitRatio = .6;
    private editorVisible = true;
    private switchingMode = false;
    private pendingWritingState?: unknown;
    private requestedWritingMode?: boolean;
    constructor(leaf: WorkspaceLeaf, private store?: OrganicStateStore,
        private settings: () => OrganicSettings = () => normalizeOrganicSettings({}), private documentHost?: ObsidianDocumentHost) { super(leaf); }
    getViewType(): string { return ORGANIC_VIEW; }
    getDisplayText(): string { return this.file ? `${this.file.basename} · Organic` : 'Organic Mind Map'; }
    getIcon(): string { return 'git-fork'; }
    getState(): Record<string, unknown> { return { viewport: this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600), file: this.sourcePath, writing: this.isWriting, splitRatio: this.splitRatio,
        editorVisible: this.editorVisible, readerVisible: this.readerVisible, writingState: this.writing ? captureWritingView(this.writing.document, this.state,
            this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600)) : this.pendingWritingState }; }
    async setState(state: { file?: string; writing?: boolean; splitRatio?: number; editorVisible?: boolean; readerVisible?: boolean; viewport?: SavedOrganicState['viewport']; writingState?: unknown; composerLayout?: SavedOrganicState['layout'] }, result: { history: boolean }): Promise<void> {
        if (Number.isFinite(state.splitRatio)) this.splitRatio = Math.max(.25, Math.min(.8, state.splitRatio!));
        this.editorVisible = state.editorVisible !== false;
        if (typeof state.readerVisible === 'boolean') this.readerVisible = state.readerVisible;
        this.pendingWritingState = state.writingState;
        this.requestedWritingMode = state.writing;
        if (typeof state.file === 'string') {
            this.sourcePath = state.file;
            const file = this.app.vault.getAbstractFileByPath(state.file);
            if (file instanceof TFile && file.extension === 'md') await this.loadSource(file);
            else this.sourceDeleted(state.file);
        }
        if (this.pendingWritingState && !this.writing) {
            await this.toggleWriting();
            if (!state.writing && this.isWriting) await this.toggleWriting();
        }
        await super.setState(state, result);
        if (typeof state.writing === 'boolean' && state.writing !== this.isWriting) {
            await this.toggleWriting();
        }
        this.requestedWritingMode = undefined;
        if (state.composerLayout && ['organic-horizontal', 'organic-radial', 'compact-organic'].includes(state.composerLayout)) {
            this.state.layout = state.composerLayout;
            this.layoutKey = '';
            this.draw();
        }
        if (Number.isFinite(state.splitRatio)) this.splitRatio = Math.max(.25, Math.min(.8, state.splitRatio!));
        if (typeof state.readerVisible === 'boolean') this.readerVisible = state.readerVisible;
        this.applySplit();
        const viewport = state.viewport;
        if (viewport && Number.isFinite(viewport.zoom) && viewport.zoom >= .05 && viewport.zoom <= 4 &&
            Number.isFinite(viewport.center?.x) && Number.isFinite(viewport.center?.y)) {
            this.scale = viewport.zoom;
            this.viewport.center(viewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
        }
        if (state.composerLayout) this.remember();
    }
    sourceRenamed(oldPath: string, path: string): void {
        if (this.sourcePath !== oldPath && !this.sourcePath?.startsWith(oldPath + '/')) return;
        this.sourcePath = path + this.sourcePath.slice(oldPath.length);
        if (this.model) {
            this.model.sourceFile = this.sourcePath;
            for (const node of this.model.nodes) node.source.file = this.sourcePath;
        }
        this.app.workspace.requestSaveLayout();
        if (this.writing) { void this.writing.sourceRenamed(this.sourcePath); return; }
        if (this.file) void this.loadSource(this.file, false);
    }
    sourceDeleted(path: string): void {
        if (this.sourcePath !== path && !this.sourcePath?.startsWith(path + '/')) return;
        this.revision++; this.autoRefresh?.cancel(); this.file = undefined;
        if (this.status) this.status.textContent = t('无法读取原笔记，请确认文件仍然存在。');
    }
    private remember(userAction = true): void {
        if (userAction) this.app.workspace.requestSaveLayout();
        if (!this.file || !this.model || !this.store) return;
        const snapshot: SavedOrganicState = { fingerprint: this.fingerprint, identities: this.identities, collapsed: [...this.collapsed],
            viewport: this.interaction.focusPaused && this.searchViewport ? this.searchViewport : this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600),
            focusNode: this.state.focusNode, reading: { ...this.state.reading },
            readerVisible: this.readerVisible, splitRatio: this.splitRatio, selectedNode: this.state.selectedNode, layout: this.state.layout, branchStyles: this.state.branchStyles,
            writing: this.writing ? { enabled: this.isWriting, splitRatio: this.splitRatio, editorVisible: this.editorVisible,
                snapshot: captureWritingView(this.writing.document, this.state, this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600)) } : undefined };
        if (userAction) this.store.put(this.file.path, snapshot, this.stateOwner);
        else this.store.sync(this.file.path, snapshot, this.stateOwner);
    }

    async onOpen(): Promise<void> {
        this.closed = false;
        this.scope = new Scope(this.app.scope);
        this.scope.register(['Mod'], 'f', event => {
            if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
            this.openSearch(); return false;
        });
        this.autoRefresh = new OrganicAutoRefreshController(async () => {
            if (this.file) await this.loadSource(this.file, false);
        }, () => this.settings().autoRefresh, () => { this.revision++; });
        this.registerEvent(this.app.vault.on('modify', file => {
            if (file.path === this.sourcePath) this.autoRefresh?.changed();
        }));
        this.contentEl.empty(); this.contentEl.addClass('cmm-organic-view');
        this.toolbar = new OrganicToolbar(this.contentEl, {
            search: query => { if (!this.model) return; this.interaction.search.update(this.model, query); this.searchJump(); },
            next: delta => { this.interaction.search.move(delta); this.searchJump(); },
            clearSearch: () => this.clearSearch(),
            focus: () => this.focusBranch(this.state.focusNode ? null : this.state.selectedNode ?? this.model?.rootId ?? null),
            reading: () => this.readBranch(this.state.reading.rootNode ? null : this.state.selectedNode ?? this.model?.rootId ?? null),
            refresh: () => { void this.refresh(); },
            fit: () => { this.fit(); this.remember(); }, zoom: factor => this.zoom(factor),
            layout: style => { this.state.layout = style; this.draw(); this.fit(); this.remember(); },
            export: format => { void this.exportMap(format); },
        });
        this.status = this.toolbar.status;
        const writingActions = this.contentEl.createDiv({ cls: 'cmm-writing-toolbar' });
        this.viewModeButton = writingActions.createEl('button', { text: 'View', attr: { 'aria-pressed': 'true' } });
        this.viewModeButton.onclick = () => { if (this.isWriting) void this.toggleWriting(); };
        this.modeButton = writingActions.createEl('button', { text: 'Edit', attr: { 'aria-pressed': 'false' } });
        this.modeButton.onclick = () => { if (!this.isWriting) void this.toggleWriting(); };
        this.readerButton = writingActions.createEl('button', { text: 'Show reader' });
        this.readerButton.onclick = () => {
            this.readerVisible = !this.readerVisible; this.applySplit(); this.remember();
        };
        const action = (text: string, run: () => unknown) => {
            const button = writingActions.createEl('button', { text, cls: 'cmm-writing-only' });
            button.onclick = () => { void run(); };
        };
        action('添加章节', () => this.writing?.inline('sibling'));
        action('更多…', () => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle('Undo').onClick(() => { void this.writing?.history('undo'); }));
            menu.addItem(item => item.setTitle('Redo').onClick(() => { void this.writing?.history('redo'); }));
            menu.addItem(item => item.setTitle('显示 / 隐藏正文').onClick(() => {
                this.editorVisible = !this.editorVisible; this.applySplit(); this.app.workspace.requestSaveLayout();
            }));
            const rect = writingActions.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
        });
        const document = this.contentEl.ownerDocument;
        this.svg = svgElement(document, 'svg', { class: 'cmm-organic-surface', role: 'group',
            'aria-label': 'Organic Mind Map', tabindex: 0 });
        this.scene = svgElement(document, 'g'); this.svg.append(this.scene); this.contentEl.append(this.svg);
        const context = document.createElement('canvas').getContext('2d')!;
        const family = document.defaultView!.getComputedStyle(this.contentEl).fontFamily;
        this.measure = (text, size, weight) => {
            context.font = `${weight} ${size}px ${family}`; return context.measureText(text).width;
        };
        this.svg.style.fontFamily = family;
        this.resizeObserver = new ResizeObserver(() => {
            // Resizing is not a viewport command: preserve the live transform.
            this.transform(); this.remember(false);
        });
        this.resizeObserver.observe(this.svg);
        let drag: { id: number; x: number; y: number } | undefined;
        this.svg.addEventListener('pointerdown', event => {
            if (event.button !== 0 || (event.target as Element).closest('[role="link"], [role="button"]')) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            this.svg.setPointerCapture(event.pointerId);
        });
        this.svg.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            this.viewport.pan(event.clientX - drag.x, event.clientY - drag.y);
            drag.x = event.clientX; drag.y = event.clientY; this.scheduleTransform(); this.remember();
        });
        const stop = () => { drag = undefined; };
        this.svg.addEventListener('pointerup', stop); this.svg.addEventListener('pointercancel', stop);
        this.svg.addEventListener('lostpointercapture', stop);
        this.svg.addEventListener('wheel', event => {
            event.preventDefault(); const rect = this.svg.getBoundingClientRect();
            this.zoom(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });
        this.contentEl.addEventListener('keydown', event => {
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault(); event.stopPropagation(); this.openSearch(); return;
            }
            if (event.key === 'Escape') {
                if (this.toolbar?.searching) this.toolbar.closeSearch();
                else if (this.state.reading.rootNode) this.readBranch(null);
                else if (this.state.focusNode) this.focusBranch(null);
                else { this.state.selectedNode = null; this.draw(); this.remember(); }
                event.preventDefault(); event.stopPropagation(); return;
            }
            if (this.state.reading.rootNode && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                const id = this.interaction.readingStep(event.key === 'ArrowUp' ? -1 : 1);
                this.draw(); if (id) this.centerNode(id); this.remember();
                event.preventDefault(); event.stopPropagation(); return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === '+' || event.key === '=') this.zoom(1.25);
            else if (event.key === '-') this.zoom(0.8);
            else if (event.key === '0') { this.fit(); this.remember(); }
            else if (event.key.startsWith('Arrow')) {
                this.offset.x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
                this.offset.y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
                this.transform(); this.remember();
            } else return;
            event.preventDefault();
        });
    }

    openSearch(): void { this.toolbar?.openSearch(); }
    async refresh(): Promise<void> { if (this.writing) { await this.writing.refresh(); return; } if (this.file) await this.loadSource(this.file, false); }
    get isWriting(): boolean { return this.writing?.active ?? false; }
    writingCommand(command: 'rename' | 'sibling' | 'child' | 'promote' | 'demote' | 'delete' | 'undo' | 'redo' | 'editor'): void {
        const writing = this.writing; if (!writing?.active) return;
        if (command === 'rename' || command === 'sibling' || command === 'child') void writing.inline(command);
        else if (command === 'undo' || command === 'redo') void writing.history(command);
        else if (command === 'delete') void writing.remove();
        else if (command === 'editor') { this.editorVisible = true; this.applySplit(); writing.editor.focus(); }
        else void writing.execute({ type: command, nodeId: writing.selected });
    }
    async toggleWriting(): Promise<void> {
        if (this.switchingMode || !this.file || !this.documentHost) return;
        this.switchingMode = true;
        try {
            if (this.writing) {
                if (this.writing.interacting) { new Notice('请先确认或取消当前标题输入。'); return; }
                if (!await this.writing.editor.flush()) return;
                this.writing.active = !this.writing.active;
                this.contentEl.classList.toggle('is-writing', this.writing.active);
                this.applySplit();
                this.modeButton!.setAttribute('aria-pressed', String(this.writing.active));
                this.viewModeButton!.setAttribute('aria-pressed', String(!this.writing.active));
                this.draw();
                this.remember();
                this.app.workspace.requestSaveLayout(); return;
            }
            const source = await this.documentHost.read(this.file.path);
            if (source.text !== this.sourceText) await this.loadSource(this.file, false);
            const previous = this.model;
            this.ensureSplit();
            const map = this.writingLayout!.querySelector<HTMLElement>('.cmm-writing-map')!;
            this.writing = new MindMapWritingController(this.app, this.documentHost, source.text, this.file.path, this.svg, map, this.editorPane!, {
                publish: (doc, selected, changed) => this.publishWriting(doc, selected, changed),
                snapshot: () => ({ selectedNode: this.state.selectedNode, collapsed: [...this.collapsed], zoom: this.scale,
                    center: this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600).center, focusNode: this.state.focusNode }),
                restore: snapshot => {
                    this.collapsed = new Set(snapshot.collapsed); this.state.focusNode = snapshot.focusNode;
                    this.scale = snapshot.zoom; this.viewport.center(snapshot.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.draw();
                }, focus: id => this.focusBranch(id), reading: () => { void this.toggleWriting(); }, changed: () => this.remember(),
            });
            const mapping = new Map<string, string>([[DOCUMENT_ROOT, DOCUMENT_ROOT]]);
            for (const node of previous?.nodes ?? []) {
                const section = Array.from(this.writing.document.sections.values()).find(s => s.line === node.source.line && s.headingText === node.title);
                if (section) mapping.set(node.id, section.id);
            }
            const remap = (id: string | null) => id ? mapping.get(id) ?? null : null;
            this.collapsed = new Set([...this.collapsed].map(id => mapping.get(id)).filter((id): id is string => !!id));
            this.state.focusNode = remap(this.state.focusNode); this.state.reading = { rootNode: null, currentNode: null };
            this.state.branchStyles = Object.fromEntries(Object.entries(this.state.branchStyles).filter(([id]) => mapping.has(id)).map(([id, style]) => [mapping.get(id)!, style]));
            this.state.selectedNode = remap(this.state.selectedNode) ?? remap(previous?.rootId ?? null) ?? DOCUMENT_ROOT;
            const restoreViewport = restoreWritingView(this.pendingWritingState, this.writing.document, this.state);
            this.pendingWritingState = undefined;
            const selected = this.state.selectedNode ?? DOCUMENT_ROOT;
            this.publishWriting(this.writing.document, selected, true);
            await this.writing.select(selected);
            this.contentEl.addClass('is-writing'); this.applySplit();
            if (restoreViewport) {
                this.scale = restoreViewport.zoom;
                this.viewport.center(restoreViewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
            }
            this.modeButton!.setAttribute('aria-pressed', 'true'); this.viewModeButton!.setAttribute('aria-pressed', 'false');
            this.app.workspace.requestSaveLayout();
            this.remember();
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
        finally { this.switchingMode = false; }
    }
    private ensureSplit(): void {
        if (this.writingLayout) return;
        const layout = this.contentEl.createDiv({ cls: 'cmm-writing-split' }); this.writingLayout = layout;
        const map = layout.createDiv({ cls: 'cmm-writing-map' }); map.append(this.svg);
        const divider = layout.createDiv({ cls: 'cmm-writing-divider', attr: { role: 'separator', tabindex: '0', 'aria-label': '调整脑图与正文宽度', 'aria-orientation': 'vertical' } });
        this.editorPane = layout.createDiv({ cls: 'cmm-writing-editor' });
        divider.onpointerdown = event => { divider.setPointerCapture(event.pointerId); event.preventDefault(); };
        divider.onpointermove = event => {
            if (!divider.hasPointerCapture(event.pointerId)) return;
            const rect = layout.getBoundingClientRect();
            this.splitRatio = Math.max(.25, Math.min(.8, (event.clientX - rect.left) / rect.width)); this.applySplit();
        };
        divider.onpointerup = event => { divider.releasePointerCapture(event.pointerId); this.remember(); };
        divider.onkeydown = event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault(); this.splitRatio = Math.max(.25, Math.min(.8, this.splitRatio + (event.key === 'ArrowLeft' ? -.05 : .05)));
            this.applySplit(); this.remember();
        };
        this.readerPane = layout.createDiv({ cls: 'cmm-organic-reader markdown-rendered', attr: { 'aria-label': 'Section reader' } });
    }
    private applySplit(): void {
        if (this.readerVisible || this.isWriting) this.ensureSplit();
        this.writingLayout?.style.setProperty('--cmm-map-ratio', `${this.splitRatio * 100}%`);
        this.writingLayout?.classList.toggle('editor-hidden', this.isWriting ? !this.editorVisible : !this.readerVisible);
        if (this.editorPane) this.editorPane.hidden = !this.isWriting;
        if (this.readerPane) this.readerPane.hidden = this.isWriting || !this.readerVisible;
        if (this.readerButton) {
            this.readerButton.hidden = this.isWriting;
            this.readerButton.textContent = this.readerVisible ? 'Hide reader' : 'Show reader';
            this.readerButton.setAttribute('aria-pressed', String(this.readerVisible));
        }
        this.updateReader();
    }
    private updateReader(): void {
        if (!this.readerPane || !this.readerVisible || this.isWriting || !this.model) return;
        const node = this.model.nodes.find(n => n.id === this.state.selectedNode) ?? this.model.nodes.find(n => n.id === this.model!.rootId)!;
        const doc = this.writing?.document ?? this.readerDocument;
        if (!doc) return;
        const key = JSON.stringify([doc.sourcePath, doc.text, node.id]);
        if (key === this.readerKey) return;
        this.readerKey = key;
        this.readerComponent?.unload();
        const component = this.readerComponent = new Component(); component.load();
        this.readerPane.empty(); this.readerPane.scrollTop = 0;
        this.readerPane.createEl('h2', { text: node.title });
        const section = node.headingLevel ? [...doc.sections.values()].find(s => s.line === node.source.line) : undefined;
        const range = section?.body ?? doc.introduction;
        const body = this.readerPane.createDiv();
        // A replaced render owns a detached target; it cannot overwrite the new selection.
        void MarkdownRenderer.render(this.app, doc.text.slice(range.start, range.end), body, doc.sourcePath, component)
            .then(() => { if (this.readerComponent !== component) component.unload(); })
            .catch(error => { if (this.readerComponent === component) body.textContent = '无法渲染此章节'; console.error(error); });
        if (node.children.length) {
            this.readerPane.createEl('h3', { text: '本节内容' });
            const list = this.readerPane.createEl('ul');
            for (const id of node.children) {
                const child = this.model.nodes.find(n => n.id === id); if (!child) continue;
                const link = list.createEl('li').createEl('button', { text: child.title, cls: 'cmm-reader-child' });
                link.onclick = () => { void this.selectHeading(id); };
            }
        }
    }
    private async selectHeading(id: string): Promise<void> {
        if (this.writing) { await this.writing.select(id); return; }
        this.state.selectedNode = id; this.draw(); this.remember();
    }
    private publishWriting(doc: DocumentStructure, selected: string, structureChanged: boolean): void {
        const anchor = this.state.selectedNode ?? undefined;
        const topology = (model: MindMapModel | undefined) => JSON.stringify(model?.nodes.map(n => [n.id, n.parentId, n.children]));
        const previousTopology = topology(this.model);
        const promotedRoot = this.model?.rootId !== DOCUMENT_ROOT && doc.roots.length === 1;
        this.model = projectDocumentMindMap(doc, this.file ? this.file.basename : doc.sourcePath);
        // Keep the existing View root semantics when first opening Edit.
        if (promotedRoot) {
            this.model.rootId = doc.roots[0];
            this.model.nodes = this.model.nodes.filter(n => n.id !== DOCUMENT_ROOT).map(n => ({ ...n,
                depth: n.depth - 1, parentId: n.id === doc.roots[0] ? undefined : n.parentId }));
        }
        this.sourceText = doc.text; this.fingerprint = sourceFingerprint(doc.text);
        this.state.selectedNode = selected;
        if (structureChanged) {
            let parent = doc.sections.get(selected)?.parentId;
            while (parent) { this.collapsed.delete(parent); parent = doc.sections.get(parent)?.parentId; }
        }
        const ids = new Set(this.model.nodes.map(node => node.id));
        this.collapsed = new Set([...this.collapsed].filter(id => ids.has(id)));
        if (this.state.focusNode && !ids.has(this.state.focusNode)) this.state.focusNode = null;
        if (this.state.focusNode && this.state.focusNode !== DOCUMENT_ROOT) {
            const focused = doc.sections.get(this.state.focusNode), current = doc.sections.get(selected);
            if (!focused || !current || current.heading.start < focused.subtree.start || current.heading.start >= focused.subtree.end) this.state.focusNode = null;
        }
        if (structureChanged) this.layoutEpoch++;
        this.interaction.update(this.model); this.draw(structureChanged && previousTopology !== topology(this.model) ? (this.model.nodes.some(n => n.id === anchor) ? anchor : selected) : undefined, structureChanged);
        this.status.textContent = `${doc.order.length} 章节 · Enter 同级 / Tab 子章节 / F2 重命名${doc.diagnostics.length ? ' · 当前文档需修复：' + doc.diagnostics[0].message : ''}`;
    }
    private async exportMap(format: 'svg' | 'png'): Promise<void> {
        const file = this.file, result = this.result;
        if (!file || !result || this.exporting) return;
        this.exporting = true;
        try {
            const doc = this.contentEl.ownerDocument, style = doc.defaultView!.getComputedStyle(this.contentEl);
            const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
            const service = new OrganicExportService();
            const svg = service.svg(doc, result, {
                background: color('--background-primary', '#fffaf4'), rootBackground: color('--background-secondary', '#f7efe4'),
                foreground: color('--text-normal', '#45423f'), border: color('--text-faint', '#c6b9a6'),
                accent: color('--interactive-accent', '#218b89'), highlight: color('--text-highlight-bg', '#ffe39c'), fontFamily: style.fontFamily,
            }, { matches: new Set(this.interaction.search.results), currentMatch: this.interaction.search.current,
                selected: this.state.selectedNode, reading: this.state.reading.currentNode, emphasized: this.interaction.emphasized() });
            const blob = format === 'svg' ? new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }) : await service.png(doc, svg, result, this.settings().pngScale);
            const parent = file.parent?.path; const base = `${parent && parent !== '/' ? parent + '/' : ''}${file.basename}-mind-map`;
            let path = `${base}.${format}`, suffix = 1;
            while (this.app.vault.getAbstractFileByPath(path)) path = `${base}-${suffix++}.${format}`;
            await this.app.vault.createBinary(path, await blob.arrayBuffer());
            new Notice(t('已导出：{path}', { path }));
        } catch (error) {
            new Notice(t(error instanceof Error && error.message === 'PNG_TOO_LARGE' ? 'PNG 尺寸过大，请降低导出倍率、折叠分支或使用 SVG。' : '导出失败，请查看控制台。'));
            console.error('Organic export failed', error);
        } finally { this.exporting = false; }
    }
    private searchJump(): void {
        if (!this.searchViewport && this.interaction.search.query) this.searchViewport = this.viewport.snapshot(this.svg.clientWidth || 800, this.svg.clientHeight || 600);
        const id = this.interaction.search.current;
        if (id) this.state.selectedNode = id;
        this.draw(); if (id) this.centerNode(id);
        this.remember();
    }
    private clearSearch(): void {
        const paused = this.interaction.focusPaused;
        this.interaction.clearSearch(); this.draw();
        if (paused && this.searchViewport) {
            this.scale = this.searchViewport.zoom;
            this.viewport.center(this.searchViewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
        }
        this.searchViewport = undefined; this.remember(); this.svg.focus();
    }
    private focusBranch(id: string | null): void {
        this.interaction.focus(id); this.draw(); this.fit(); this.remember(); this.svg.focus();
    }
    private readBranch(id: string | null): void {
        this.interaction.read(id); this.draw(); if (id) this.centerNode(id); this.remember(); this.svg.focus();
    }
    private centerNode(id: string): void {
        const node = this.result?.nodes.find(n => n.id === id); if (!node) return;
        this.viewport.follow({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, this.svg.clientWidth || 800, this.svg.clientHeight || 600,
            this.contentEl.ownerDocument?.defaultView, this.settings().animation ? this.settings().animationDuration : 0,
            offset => {
                this.scene.setAttribute('transform', `translate(${offset.x} ${offset.y}) scale(${this.scale})`);
                this.remember(false);
            });
    }
    private contextMenu(id: string, event: MouseEvent): void {
        if (this.writing?.active) { this.writing.menu(id, event); return; }
        void this.selectHeading(id);
        const menu = new Menu();
        menu.addItem(item => item.setTitle(t('聚焦当前分支')).onClick(() => this.focusBranch(id)));
        menu.addItem(item => item.setTitle(t('阅读此分支')).onClick(() => this.readBranch(id)));
        menu.addItem(item => item.setTitle(t('打开原文')).onClick(() => { void this.navigate(id, true); }));
        menu.showAtMouseEvent(event);
    }

    async loadSource(file: TFile, reset = true): Promise<void> {
        if (this.writing && file.path === this.writing.document.sourcePath) { await this.writing.externalChange(); return; }
        if (this.writing) {
            await this.writing.close(); this.writing = undefined;
            this.contentEl.append(this.svg); this.writingLayout?.remove(); this.writingLayout = undefined; this.editorPane = undefined; this.readerPane = undefined; this.readerKey = '';
            this.readerComponent?.unload(); this.readerComponent = undefined;
            this.contentEl.removeClass('is-writing');
        }
        const revision = ++this.revision;
        try {
            const markdown = await this.app.vault.read(file);
            if (this.closed || revision !== this.revision) return;
            const fingerprint = sourceFingerprint(markdown);
            const saved = reset ? this.store?.get(file.path) : undefined;
            const previous = reset ? saved?.identities ?? [] : this.identities;
            const mapped = reconcileOrganicModel(buildMindMapModel(markdown, { title: file.basename, file: file.path }),
                previous, fingerprint === (reset ? saved?.fingerprint : this.fingerprint));
            const model = mapped.model;
            const structure = (m: MindMapModel | undefined) => JSON.stringify(m?.nodes.map(n => [n.id, n.title, n.depth, n.parentId, n.children]));
            const layoutChanged = reset || structure(this.model) !== structure(model);
            if (layoutChanged) this.layoutEpoch++;
            this.file = file; this.sourcePath = file.path; this.model = model; this.sourceText = markdown;
            this.fingerprint = fingerprint; this.identities = mapped.identities;
            this.readerDocument = new DocumentStructureParser().parse(markdown, { sourcePath: file.path });
            const restore = saved?.identities ? saved : undefined;
            if (reset) {
                this.state.reset(model, this.settings().defaultLayout);
                if (restore) this.state.restore(restore, model);
                if (saved) { this.readerVisible = saved.readerVisible === true; this.splitRatio = saved.splitRatio ?? saved.writing?.splitRatio ?? .6; }
                this.applySplit();
            }
            else {
                const ids = new Set(model.nodes.map(n => n.id));
                this.collapsed = new Set([...this.collapsed].filter(id => ids.has(id)));
                if (this.state.focusNode && !ids.has(this.state.focusNode)) this.state.focusNode = null;
                if (this.state.selectedNode && !ids.has(this.state.selectedNode)) this.state.selectedNode = null;
                if (this.state.reading.rootNode && !ids.has(this.state.reading.rootNode)) this.state.reading = { rootNode: null, currentNode: null };
                else if (this.state.reading.currentNode && !ids.has(this.state.reading.currentNode)) this.state.reading.currentNode = this.state.reading.rootNode;
            }
            this.interaction.update(model);
            if (layoutChanged) this.draw(reset ? undefined : this.state.selectedNode ?? undefined);
            this.updateReader();
            if (restore) {
                this.scale = restore.viewport.zoom;
                this.viewport.center(restore.viewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600);
                this.transform();
            } else if (reset) this.fit();
            this.status.textContent = `${file.basename} · ${model.nodes.length} ${t('标题节点')} · ${t('点击标题跳转，拖动空白平移')}`;
            if (!reset) this.remember(false);
            if (reset && saved?.writing && !this.writing) {
                this.splitRatio = saved.writing.splitRatio; this.editorVisible = saved.writing.editorVisible;
                this.pendingWritingState = this.pendingWritingState ?? saved.writing.snapshot;
                await this.toggleWriting();
                if (!(this.requestedWritingMode ?? saved.writing.enabled) && this.isWriting) await this.toggleWriting();
                // Restore once against the final pane dimensions, never on a later mode switch.
                this.scale = saved.viewport.zoom;
                this.viewport.center(saved.viewport.center, this.svg.clientWidth || 800, this.svg.clientHeight || 600); this.transform();
                this.remember(false);
            }
        } catch (error) {
            if (revision !== this.revision || this.closed) return;
            new Notice(t('无法读取原笔记，请确认文件仍然存在。'));
            console.error('Organic mind map: source load failed', error);
        }
    }

    private draw(anchorId?: string, animate = false): void {
        if (!this.model) return;
        const projection = this.interaction.projection();
        if (!projection) return;
        const old = this.result?.nodes.find(node => node.id === anchorId);
        const key = JSON.stringify([this.layoutEpoch, this.state.layout, this.state.focusNode, this.interaction.focusPaused, [...projection.collapsed]]);
        const result = this.result && this.layoutKey === key ? this.result : this.engine.layout(projection.model, {
            collapsed: projection.collapsed, measureText: this.measure,
            style: this.state.layout, referenceModel: this.model, branchStyles: this.state.branchStyles }, this.result);
        this.layoutKey = key;
        this.state.branchStyles = result.branchStyles ?? {};
        const next = result.nodes.find(node => node.id === anchorId);
        if (old && next) {
            this.offset.x += (old.x - next.x) * this.scale;
            this.offset.y += (old.y - next.y) * this.scale;
        }
        this.result = result;
        this.renderer.render(this.scene, result, {
            navigate: id => { void this.navigate(id); },
            toggle: id => {
                this.interaction.toggle(id);
                this.toolbar?.setQuery(this.interaction.search.query);
                this.draw(id, true);
                this.remember();
                // Restore keyboard focus after replacing the rendered tree.
                const group = Array.from(this.scene.querySelectorAll<SVGGElement>('[data-node-id]'))
                    .find(element => element.getAttribute('data-node-id') === id);
                group?.querySelector<SVGGElement>('[role="button"]')?.focus({ preventScroll: true });
            },
            toggleLabel: collapsed => t(collapsed ? '展开下一级' : '收起分支'),
            contextMenu: (id, event) => this.contextMenu(id, event),
            matches: new Set(this.interaction.search.results), currentMatch: this.interaction.search.current,
            selected: this.state.selectedNode, reading: this.state.reading.currentNode,
            emphasized: this.interaction.emphasized(),
            writingCounts: this.writing?.active ? new Map(this.model.nodes.map(node => {
                const doc = this.writing!.document, range = doc.sections.get(node.id)?.body ?? doc.introduction;
                return [node.id, countWritingWords(doc.text.slice(range.start, range.end))];
            })) : undefined,
            duration: animate && this.settings().animation ? this.settings().animationDuration : 0,
            previousTranslation: old && next ? { x: next.x - old.x, y: next.y - old.y } : undefined,
        });
        this.toolbar?.update(this.interaction.search.index, this.interaction.search.results.length, !!this.state.focusNode, !!this.state.reading.rootNode, this.state.layout);
        this.transform();
        this.updateReader();
    }

    private async navigate(id: string, sourceOnly = false): Promise<void> {
        if (!sourceOnly && !this.isWriting && this.readerVisible) { await this.selectHeading(id); return; }
        if (this.writing?.active) { await this.writing.select(id); return; }
        const node = this.model?.nodes.find(n => n.id === id), file = this.file;
        if (!node || !file) return;
        this.state.selectedNode = id; this.remember();
        this.scene.querySelectorAll?.('[data-node-id]').forEach(el => el.classList.toggle('is-selected', el.getAttribute('data-node-id') === id));
        const revision = this.revision, snapshot = this.sourceText;
        try {
            const current = await this.app.vault.read(file);
            if (this.closed || revision !== this.revision) return;
            if (current !== snapshot) {
                new Notice(t('原笔记已修改，请先刷新导图再跳转。')); return;
            }
            const leaf = this.sourceLeaf && this.app.workspace.getLeavesOfType('markdown').includes(this.sourceLeaf)
                ? this.sourceLeaf : this.app.workspace.getLeaf('split');
            this.sourceLeaf = leaf;
            await leaf.openFile(file, { active: true, eState: { line: node.source.line } });
        } catch (error) { new Notice(t('无法读取原笔记，请确认文件仍然存在。')); }
    }
    private transform(): void {
        const win = this.contentEl.ownerDocument?.defaultView;
        if (this.transformFrame !== undefined) win?.cancelAnimationFrame(this.transformFrame);
        this.transformFrame = undefined;
        this.viewport.cancel();
        this.scene.setAttribute('transform', `translate(${this.offset.x} ${this.offset.y}) scale(${this.scale})`);
    }
    private scheduleTransform(): void {
        const win = this.contentEl.ownerDocument?.defaultView;
        if (!win) { this.transform(); return; }
        if (this.transformFrame === undefined) this.transformFrame = win.requestAnimationFrame(() => { this.transformFrame = undefined; this.transform(); });
    }
    private zoom(factor: number, x = this.svg.clientWidth / 2, y = this.svg.clientHeight / 2): void {
        this.viewport.zoom(factor, x, y); this.scheduleTransform(); this.remember();
    }
    private fit(): void {
        if (!this.result) return;
        const { bounds } = this.result;
        const width = this.svg.clientWidth || 800, height = this.svg.clientHeight || 600;
        this.viewport.fit(bounds, width, height);
        this.transform();
    }
    async onClose(): Promise<void> {
        await this.writing?.close(); this.writing = undefined;
        this.readerComponent?.unload(); this.readerComponent = undefined;
        this.closed = true; this.revision++; this.autoRefresh?.close(); this.viewport.cancel(); this.renderer.close?.();
        if (this.transformFrame !== undefined) this.contentEl.ownerDocument?.defaultView?.cancelAnimationFrame(this.transformFrame);
        this.resizeObserver?.disconnect(); this.contentEl.empty();
        await this.store?.flush();
    }
}

