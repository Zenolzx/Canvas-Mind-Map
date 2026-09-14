import { buildMindMapModel } from './core/MindMapModel';
import { NativeCanvasRenderer } from './native/NativeCanvasRenderer';
import { FuzzySuggestModal, ItemView, Menu, MenuItem, Modal, Notice, Setting } from 'obsidian';
import { around } from 'monkey-around';
import type { AllCanvasNodeData, CanvasData, NodeSide } from 'obsidian/canvas';
import type CanvasMindMapPlugin from '../main';
import type { Canvas, CanvasEdge, CanvasNode, CanvasView } from '../Canvas';
import { randomId, sanitizeHeading } from './utils';
import { DEFAULT_MINDMAP_LEVELS, layoutLabels, MindmapLevelStyle, MindmapLayout } from './settings';
import { languageOptions, t } from './i18n';
import {
    applyStyle, assignAngles, captureOverrides, descendants, hiddenNodes, meta, MINDMAP_KEY,
    layoutFocusedSubtree, MindmapMeta, placeNodes, treeEdge, treeNodes,
} from './MindmapModel';

const HIDDEN = 'cmm-mindmap-hidden';
const BUTTON = 'cmm-mindmap-toggle';
const DIM = 'cmm-mindmap-dim';

interface ReadingFocus {
    id: string;
    rootId: string;
    mode: 'hide' | 'dim';
    expanded: Map<string, boolean>;
    savedExpanded: Map<string, boolean>;
    viewport: { x: number; y: number; zoom: number };
    selection: string[];
    compact: boolean;
    positions: Map<string, { x: number; y: number }>;
    edges: Map<string, { fromSide?: NodeSide; toSide?: NodeSide }>;
    bar?: HTMLElement;
}

// `setSubmenu` is available in Obsidian's runtime, but is not yet included in
// its public TypeScript declarations. Keep the internal API boundary local.
interface SubmenuMenuItem extends MenuItem {
    setSubmenu(): Menu;
}

/** Canvas owns serialization and undo. We add metadata and a reversible display layer. */
export class CanvasMindmap {
    private stopped = false;
    private previewSizes = new WeakMap<CanvasNode, { renderer: object; width: number; height: number }>();
    private frames = new Map<Canvas, { win: Window; id: number }>();
    private menuItems = new WeakMap<Menu, Set<string>>();
    private refreshing = new WeakSet<Canvas>();
    private fitting = new WeakSet<Canvas>();
    private projecting = new WeakSet<Canvas>();
    private pendingPlacement = new Map<Canvas, Set<string>>();
    private placementAnchors = new WeakMap<Canvas, string>();
    private reading = new Map<Canvas, ReadingFocus>();
    private observers = new Map<CanvasNode, { content: HTMLElement; mutation: MutationObserver; resize?: ResizeObserver }>();

    constructor(private plugin: CanvasMindMapPlugin) {}

    register(): void {
        this.plugin.register(() => {
            this.stopped = true;
            for (const frame of this.frames.values()) frame.win.cancelAnimationFrame(frame.id);
            this.frames.clear();
            this.pendingPlacement.clear();
            for (const node of this.observers.keys()) this.unobserve(node);
            this.eachCanvas(canvas => this.clearDisplay(canvas));
        });
        this.plugin.registerLazyPatcher(() => {
            const canvas = this.plugin.app.workspace.getLeavesOfType('canvas')
                .map(leaf => (leaf.view as CanvasView).canvas).find(Boolean);
            if (!canvas) return false;
            const prototype = Object.getPrototypeOf(canvas);
            if (!prototype.importData || !prototype.requestFrame || !prototype.updateSelection) return false;
            const feature = this;
            this.plugin.register(around(prototype, {
                importData: (next: Canvas['importData']) => function(this: Canvas, data: CanvasData, clear?: boolean) {
                    const result = next.call(this, data, clear);
                    feature.render(this, false);
                    feature.schedule(this);
                    return result;
                },
                requestFrame: (next: Canvas['requestFrame']) => function(this: Canvas) {
                    next.call(this);
                    feature.schedule(this);
                },
                requestSave: (next: Canvas['requestSave']) => function(this: Canvas, history?: boolean) {
                    // Native auto-fit saves repeatedly while measuring. Keep it in the
                    // originating operation's undo step instead of adding resize steps.
                    const focus = feature.reading.get(this);
                    if (!focus?.compact || feature.projecting.has(this)) return next.call(this, feature.fitting.has(this) ? false : history);
                    const projection = JSON.parse(JSON.stringify(this.getData())) as CanvasData;
                    const persistent = feature.persistentData(this, JSON.parse(JSON.stringify(this.getData())) as CanvasData, false);
                    feature.projecting.add(this);
                    try {
                        this.importData(persistent);
                        const result = next.call(this, feature.fitting.has(this) ? false : history);
                        // Keep native/manual movement visible for this focus session;
                        // only the restored geometry was handed to Canvas persistence.
                        this.importData(projection);
                        return result;
                    } finally { feature.projecting.delete(this); }
                },
                updateSelection: (next: Canvas['updateSelection']) => function(this: Canvas, callback: () => void) {
                    return next.call(this, () => {
                        callback();
                        const hidden = feature.displayState(this, this.getData()).hidden;
                        // Native selection also contains edges, despite the older Canvas typings.
                        for (const item of this.selection as Set<CanvasNode | CanvasEdge>) {
                            if (feature.isHidden(item, hidden)) this.selection.delete(item as CanvasNode);
                        }
                    });
                },
            }));
            this.eachCanvas(current => this.schedule(current));
            return true;
        });
        this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
            for (const node of this.observers.keys()) if (!node.nodeEl.isConnected) this.unobserve(node);
            for (const [canvas, focus] of this.reading) if (!canvas.view.containerEl.isConnected) {
                focus.bar?.remove(); this.exitFocus(canvas);
            }
            this.eachCanvas(canvas => this.schedule(canvas));
        }));
        this.command('mindmap-create', t('生成可折叠思维导图'), (canvas, node) => this.generationDialog(canvas, node), true);
        this.command('mindmap-expand', t('思维导图：展开下一级'), (canvas, node) => this.fold(canvas, node.id, true));
        this.command('mindmap-collapse', t('思维导图：收起分支'), (canvas, node) => this.fold(canvas, node.id, false));
        this.command('mindmap-depth', t('思维导图：显示到第 N 层'), (canvas, node) => this.depthDialog(canvas, node.id));
        this.command('mindmap-center', t('思维导图：返回中心'), (canvas, node) => this.center(canvas, node.id), false, true);
        this.command('mindmap-layout', t('思维导图：重新排列整图'), (canvas, node) => this.relayout(canvas, node.id));
        this.command('mindmap-layout-select', t('思维导图：切换布局'), (canvas, node) => this.layoutDialog(canvas, node.id));
        this.command('mindmap-refresh', t('思维导图：从原笔记刷新'), (canvas, node) => this.refresh(canvas, node.id));
        this.command('mindmap-template', t('思维导图：应用层级模板'), (canvas, node) => this.applyTemplate(canvas, node.id));
        this.command('mindmap-style', t('思维导图：设置当前节点外观'), (canvas, node) => this.styleDialog(canvas, node.id));
        this.command('mindmap-focus', t('思维导图：聚焦当前分支'), (canvas, node) => this.focusBranch(canvas, node.id), false, true);
        this.command('mindmap-overview', t('思维导图：查看全貌'), (canvas, node) => this.overview(canvas, node.id), false, true);
        this.command('mindmap-search', t('思维导图：搜索标题'), (canvas, node) => this.search(canvas, node.id), false, true);
        this.plugin.addCommand({ id: 'mindmap-focus-exit', name: t('思维导图：退出分支聚焦'), checkCallback: checking => {
            const view = this.plugin.app.workspace.getActiveViewOfType(ItemView);
            const canvas = view?.getViewType() === 'canvas' ? (view as CanvasView).canvas : undefined;
            if (!canvas || !this.reading.has(canvas)) return false;
            if (!checking) this.exitFocus(canvas);
            return true;
        } });
    }

    private eachCanvas(callback: (canvas: Canvas) => void): void {
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view.getViewType() === 'canvas') {
                const canvas = (leaf.view as CanvasView).canvas;
                if (canvas) callback(canvas);
            }
        });
    }

    private selection(): { canvas: Canvas; node: CanvasNode } | undefined {
        const view = this.plugin.app.workspace.getActiveViewOfType(ItemView);
        if (view?.getViewType() !== 'canvas') return;
        const canvas = (view as CanvasView).canvas;
        if (!canvas || canvas.selection.size !== 1) return;
        const node = Array.from(canvas.selection)[0];
        if (!canvas.nodes.has(node.id)) return;
        return { canvas, node };
    }

    private command(id: string, name: string, action: (canvas: Canvas, node: CanvasNode) => void | Promise<void>, create = false, readonly = false): void {
        this.plugin.addCommand({ id, name, checkCallback: checking => {
            const selected = this.selection();
            if (!selected || (!readonly && selected.canvas.readonly)) return false;
            const state = meta(selected.node.getData());
            const valid = create ? !state && this.isSource(selected.node) : !!state;
            if (!valid) return false;
            if (!checking) this.run(() => action(selected.canvas, selected.node));
            return true;
        } });
    }

    private isSource(node: CanvasNode): boolean {
        return node.file?.extension === 'md' || (!node.file && node.text !== undefined);
    }

    addSelectionMenu(menu: Menu): void {
        const selection = this.selection();
        if (selection) this.addMenu(menu, selection.node);
    }

    addMenu(menu: Menu, node: CanvasNode): void {
        const canvas = node.canvas;
        let added = this.menuItems.get(menu);
        if (!added) { added = new Set(); this.menuItems.set(menu, added); }
        if (added.has(node.id)) return;
        added.add(node.id);
        const state = meta(node.getData());
        const item = (title: string, action: () => void | Promise<void>) => menu.addItem(entry =>
            entry.setTitle(title).setSection('canvas-mind-map').onClick(() => this.run(action)));
        const submenu = (title: string, build: (submenu: Menu) => void) => menu.addItem(entry => {
            const submenuItem = entry as SubmenuMenuItem;
            if (typeof submenuItem.setSubmenu !== 'function') return;
            submenuItem.setTitle(title).setSection('canvas-mind-map');
            build(submenuItem.setSubmenu());
        });
        const submenuItem = (submenu: Menu, title: string, action: () => void | Promise<void>) => submenu.addItem(entry =>
            entry.setTitle(title).onClick(() => this.run(action)));
        if (!state) {
            if (canvas.readonly || !this.isSource(node)) return;
            item(t('生成可折叠思维导图'), () => this.generationDialog(canvas, node));
            return;
        }
        item(t('返回思维导图中心'), () => this.center(canvas, node.id));
        item(t('聚焦当前分支'), () => this.focusBranch(canvas, node.id));
        if (this.reading.has(canvas)) item(t('退出分支聚焦'), () => this.exitFocus(canvas));
        if (!canvas.readonly) {
            item(t('展开下一级标题'), () => this.fold(canvas, node.id, true));
            item(t('收起整个分支'), () => this.fold(canvas, node.id, false));
            submenu(t('布局'), layout => {
                submenuItem(layout, t('重新排列整张思维导图'), () => this.relayout(canvas, node.id));
                submenuItem(layout, t('切换思维导图布局…'), () => this.layoutDialog(canvas, node.id));
            });
        }
        submenu(t('选项'), options => {
            submenuItem(options, t('查看思维导图全貌'), () => this.overview(canvas, node.id));
            submenuItem(options, t('搜索标题（包含折叠节点）…'), () => this.search(canvas, node.id));
            if (canvas.readonly) return;
            options.addSeparator();
            submenuItem(options, t('显示到第 N 层…'), () => this.depthDialog(canvas, node.id));
            submenuItem(options, t('应用层级模板（保留单节点覆盖）'), () => this.applyTemplate(canvas, node.id));
            submenuItem(options, t('设置此节点外观…'), () => this.styleDialog(canvas, node.id));
            options.addSeparator();
            submenuItem(options, t('从原笔记刷新思维导图'), () => this.refresh(canvas, node.id));
        });
    }

    private run(action: () => void | Promise<void>): void {
        void Promise.resolve().then(action).catch(error => {
            console.error('Canvas Mind Map: action failed', error);
            new Notice(t('思维导图操作失败，请查看控制台。'));
        });
    }

    private readData(canvas: Canvas): CanvasData {
        // getData retains unknown-field object references; never mutate a history snapshot.
        return this.readingData(canvas, JSON.parse(JSON.stringify(canvas.getData())) as CanvasData);
    }

    refreshLanguage(): void {
        for (const [canvas, focus] of this.reading) this.buildFocusBar(canvas, focus);
        this.eachCanvas(canvas => this.render(canvas, false));
    }

    /** Focus folding is view-local: it never changes the serialized expansion flags. */
    private readingData(canvas: Canvas, data: CanvasData): CanvasData {
        const focus = this.reading.get(canvas);
        if (!focus) return data;
        return { ...data, nodes: data.nodes.map(node => {
            const state = meta(node), expanded = focus.expanded.get(node.id);
            return state?.rootId === focus.rootId && expanded !== undefined
                ? { ...node, [MINDMAP_KEY]: { ...state, expanded } } : node;
        }) };
    }

    private persistentData(canvas: Canvas, data: CanvasData, captureExpanded = true): CanvasData {
        const focus = this.reading.get(canvas);
        if (!focus) return data;
        for (const node of data.nodes) {
            const state = meta(node);
            if (state?.rootId !== focus.rootId) continue;
            if (captureExpanded) focus.expanded.set(node.id, state.expanded);
            if (!focus.savedExpanded.has(node.id)) {
                focus.savedExpanded.set(node.id, state.expanded);
                if (!focus.expanded.has(node.id)) focus.expanded.set(node.id, state.expanded);
            }
            state.expanded = focus.savedExpanded.get(node.id)!;
            const position = focus.positions.get(node.id);
            if (position) { node.x = position.x; node.y = position.y; }
            else focus.positions.set(node.id, { x: node.x, y: node.y });
        }
        for (const edge of data.edges) {
            const original = focus.edges.get(edge.id);
            if (original) { edge.fromSide = original.fromSide; edge.toSide = original.toSide; }
            else focus.edges.set(edge.id, { fromSide: edge.fromSide, toSide: edge.toSide });
        }
        return data;
    }

    private commit(canvas: Canvas, data: CanvasData, newlyVisible?: Set<string>): void {
        if (canvas.readonly || this.stopped) return;
        if (newlyVisible) {
            const hidden = hiddenNodes(data.nodes);
            const pending = this.pendingPlacement.get(canvas) ?? new Set<string>();
            for (const id of newlyVisible) if (!hidden.has(id)) pending.add(id);
            this.pendingPlacement.set(canvas, pending);
        }
        canvas.setData(this.persistentData(canvas, data));
        canvas.requestSave(false); // setData already pushes one native undo entry.
        if (this.reading.get(canvas)?.compact) this.applyFocusLayout(canvas, false);
        this.render(canvas, false);
        this.schedule(canvas);
    }

    private async source(node: CanvasNode): Promise<string> {
        const source = meta(node.getData())?.source;
        if (source?.file) {
            const file = this.plugin.app.vault.getFileByPath(source.file);
            if (!file) throw new Error('Mindmap source file is missing');
            return this.plugin.app.vault.read(file);
        }
        if (source?.text !== undefined) return source.text;
        if (node.file?.extension === 'md') return this.plugin.app.vault.read(node.file);
        if (node.text !== undefined) return node.text;
        throw new Error('Mindmap source is no longer a Markdown file or text card');
    }

    private style(depth: number): MindmapLevelStyle {
        return { ...this.plugin.settings.mindmapLevels[Math.min(depth, 6)] };
    }

    private makeNodes(canvas: Canvas, root: CanvasNode, raw: string, mode: 'title' | 'body'): AllCanvasNodeData[] {
        const sourcePath = meta(root.getData())?.source?.file;
        const sourceFile = sourcePath ? this.plugin.app.vault.getFileByPath(sourcePath) : root.file;
        const model = buildMindMapModel(raw, {
            title: sourceFile?.basename ?? t('中心'), file: sourceFile?.path,
            promoteSingleRoot: !!meta(root.getData())?.compact,
        });
        return new NativeCanvasRenderer().render(model, {
            rootId: root.id, x: root.x, y: root.y, mode, id: randomId, style: depth => this.style(depth),
            payload: (title, content) => {
                const link = sourceFile ? this.plugin.app.fileManager.generateMarkdownLink(
                    sourceFile, canvas.view.file.path, `#${title}`, title || t('无标题')) : title || t('无标题');
                const text = mode === 'body' ? content : `**${link}**`;
                return sourceFile && mode === 'body'
                    ? { data: { type: 'file', file: sourceFile.path, subpath: `#${sanitizeHeading(title)}` } }
                    : { data: { type: 'text', text }, generatedText: text };
            },
        });
    }
    private generationDialog(canvas: Canvas, node: CanvasNode): void {
        const dialog = new Modal(this.plugin.app);
        let mode = this.plugin.settings.lastMode, layout = this.plugin.settings.lastLayout;
        dialog.titleEl.setText(t('生成可折叠思维导图'));
        new Setting(dialog.contentEl).setName(t('节点内容')).addDropdown(dropdown => dropdown
            .addOptions({ title: t('仅标题'), body: t('含正文') }).setValue(mode)
            .onChange(value => { mode = value as 'title' | 'body'; }));
        new Setting(dialog.contentEl).setName(t('布局')).addDropdown(dropdown => dropdown
            .addOptions(layoutLabels()).setValue(layout).onChange(value => { layout = value as MindmapLayout; }));
        new Setting(dialog.contentEl).addButton(button => button.setButtonText(t('取消')).onClick(() => dialog.close()))
            .addButton(button => button.setButtonText(t('生成')).setCta().onClick(() => {
                dialog.close();
                this.run(async () => {
                    if (this.stopped || canvas.readonly || canvas.nodes.get(node.id) !== node) return;
                    this.plugin.settings.lastMode = mode;
                    this.plugin.settings.lastLayout = layout;
                    await this.plugin.saveSettings();
                    await this.generate(canvas, node, mode, layout);
                });
            }));
        dialog.open();
    }

    private layoutDialog(canvas: Canvas, id: string): void {
        const node = canvas.nodes.get(id), state = node && meta(node.getData());
        const root = state && canvas.nodes.get(state.rootId);
        if (!root || canvas.readonly) return;
        const dialog = new Modal(this.plugin.app);
        let layout = meta(root.getData())?.layout ?? 'radial';
        dialog.titleEl.setText(t('切换思维导图布局'));
        new Setting(dialog.contentEl).setName(t('布局')).setDesc(t('重新排列整棵导图，保留内容、样式和折叠状态。可撤销。'))
            .addDropdown(dropdown => dropdown.addOptions(layoutLabels()).setValue(layout)
                .onChange(value => { layout = value as MindmapLayout; }));
        new Setting(dialog.contentEl).addButton(button => button.setButtonText(t('取消')).onClick(() => dialog.close()))
            .addButton(button => button.setButtonText(t('应用布局')).setCta().onClick(() => {
                dialog.close();
                this.run(() => this.relayout(canvas, id, layout));
            }));
        dialog.open();
    }

    private async generate(canvas: Canvas, root: CanvasNode, mode: 'title' | 'body', layout: MindmapLayout): Promise<void> {
        if (canvas.readonly || meta(root.getData())) return;
        const raw = await this.source(root);
        if (this.stopped || canvas.readonly || canvas.nodes.get(root.id) !== root || meta(root.getData())) return;
        const nodes = this.makeNodes(canvas, root, raw, mode);
        if (!nodes.length) { new Notice(t('没有找到可生成思维导图的标题。')); return; }
        const data = this.readData(canvas);
        const rootData = data.nodes.find(node => node.id === root.id)!;
        const rootStyle = { width: root.width, height: root.height, color: rootData.color ?? '', autoHeight: false };
        rootData[MINDMAP_KEY] = {
            version: 1, nodeId: root.id, rootId: root.id, depth: 0, key: '', title: root.file?.basename ?? t('中心'),
            expanded: true, angle: 0, placed: true, mode, layout, style: rootStyle,
            applied: { width: root.width, height: root.height, color: rootData.color ?? '' },
            overrides: { width: true, height: true, color: true },
        } as MindmapMeta;
        data.nodes.push(...nodes);
        for (const node of nodes) data.edges.push(treeEdge(randomId(), root.id, meta(node)!.parentId!, node.id));
        const centerId = this.compactRoot(data, root.id, raw, canvas.view.file.path);
        for (const node of treeNodes(data, centerId)) meta(node)!.expanded = meta(node)!.depth < 2;
        assignAngles(treeNodes(data, centerId), centerId);
        placeNodes(data, centerId, new Set(nodes.map(node => node.id)));
        this.commit(canvas, data, new Set(nodes.map(node => node.id)));
        this.center(canvas, centerId);
        new Notice(t('已生成思维导图，共 {count} 个节点，显示到第 2 层。', { count: treeNodes(data, centerId).length }));
    }

    private fold(canvas: Canvas, id: string, expanded: boolean): void {
        const data = this.readData(canvas), node = data.nodes.find(item => item.id === id);
        const state = node && meta(node);
        if (!state) return;
        const before = hiddenNodes(data.nodes);
        state.expanded = expanded;
        if (!expanded) for (const child of descendants(treeNodes(data, state.rootId), id)) meta(child)!.expanded = false;
        const after = hiddenNodes(data.nodes);
        const revealed = new Set([...before].filter(nodeId => !after.has(nodeId)));
        this.placementAnchors.set(canvas, id);
        placeNodes(data, state.rootId, revealed, id);
        this.commit(canvas, data, revealed);
        const focus = canvas.nodes.get(id);
        if (!canvas.selection.size && focus) canvas.select(focus);
    }

    private depthDialog(canvas: Canvas, id: string): void {
        let depth = 2;
        const dialog = new Modal(this.plugin.app);
        dialog.setTitle(t('显示到第几层'));
        new Setting(dialog.contentEl).setName(t('中心为第 0 层')).setDesc(t('统一重设整张导图的展开状态。'))
            .addSlider(slider => slider.setLimits(0, 6, 1).setValue(depth).setDynamicTooltip().onChange(value => { depth = value; }));
        new Setting(dialog.contentEl).addButton(button => button.setButtonText(t('应用')).setCta().onClick(() => {
            const data = this.readData(canvas), selected = data.nodes.find(node => node.id === id);
            const state = selected && meta(selected);
            if (state) {
                const before = hiddenNodes(data.nodes);
                for (const node of treeNodes(data, state.rootId)) meta(node)!.expanded = meta(node)!.depth < depth;
                const after = hiddenNodes(data.nodes);
                const revealed = new Set([...before].filter(nodeId => !after.has(nodeId)));
                this.placementAnchors.set(canvas, state.rootId);
                placeNodes(data, state.rootId, revealed, state.rootId);
                this.commit(canvas, data, revealed);
                if (!canvas.selection.size) this.center(canvas, state.rootId);
            }
            dialog.close();
        }));
        dialog.open();
    }

    private center(canvas: Canvas, id: string): void {
        const state = canvas.nodes.get(id) && meta(canvas.nodes.get(id)!.getData());
        const root = state && canvas.nodes.get(state.rootId);
        if (!root) { new Notice(t('中心节点已不存在。')); return; }
        canvas.deselectAll(); canvas.select(root); canvas.zoomToSelection();
    }

    private displayState(canvas: Canvas, data: CanvasData): { hidden: Set<string>; dim: Set<string> } {
        data = this.readingData(canvas, data);
        const hidden = hiddenNodes(data.nodes), dim = new Set<string>();
        const focus = this.reading.get(canvas);
        if (!focus) return { hidden, dim };
        const tree = treeNodes(data, focus.rootId);
        if (!tree.some(node => node.id === focus.id)) return { hidden, dim };
        const keep = new Set([focus.id, ...descendants(tree, focus.id).map(node => node.id)]);
        const lookup = new Map(tree.map(node => [node.id, node]));
        let id: string | undefined = focus.id;
        const seen = new Set<string>();
        while (id && !seen.has(id)) {
            seen.add(id); keep.add(id);
            id = meta(lookup.get(id)!)?.parentId;
            if (id && !lookup.has(id)) break;
        }
        for (const node of data.nodes) if (!keep.has(node.id)) (focus.mode === 'hide' ? hidden : dim).add(node.id);
        return { hidden, dim };
    }

    private zoomNodes(canvas: Canvas, ids: string[], selected: string): void {
        const hidden = this.displayState(canvas, canvas.getData()).hidden;
        canvas.deselectAll();
        for (const id of ids) {
            const node = canvas.nodes.get(id);
            if (node && !hidden.has(id)) canvas.select(node);
        }
        if (canvas.selection.size) canvas.zoomToSelection();
        canvas.deselectAll();
        const node = canvas.nodes.get(selected);
        if (node && !hidden.has(selected)) canvas.select(node);
    }

    private focusBranch(canvas: Canvas, id: string): void {
        const data = this.readData(canvas), node = data.nodes.find(item => item.id === id), state = node && meta(node);
        if (!state) return;
        let focus = this.reading.get(canvas);
        if (focus && focus.rootId !== state.rootId) { this.exitFocus(canvas); focus = undefined; }
        if (!focus) {
            const expanded = new Map(treeNodes(data, state.rootId).map(node => [node.id, meta(node)!.expanded]));
            focus = { id, rootId: state.rootId, mode: this.plugin.settings.focusMode,
                expanded: new Map(expanded), savedExpanded: new Map(expanded), compact: this.plugin.settings.compactFocus,
                positions: new Map(data.nodes.map(node => [node.id, { x: node.x, y: node.y }])),
                edges: new Map(data.edges.map(edge => [edge.id, { fromSide: edge.fromSide, toSide: edge.toSide }])),
                viewport: { ...canvas.getState() }, selection: [...canvas.selection].map(node => node.id) };
            this.reading.set(canvas, focus);
        }
        focus.id = id;
        this.buildFocusBar(canvas, focus);
        this.applyFocusLayout(canvas, true);
    }

    private buildFocusBar(canvas: Canvas, focus: ReadingFocus): void {
        const node = canvas.nodes.get(focus.id), state = node && meta(node.getData());
        if (!state) return;
        focus.bar?.remove();
        const host = canvas.view.containerEl.querySelector<HTMLElement>('.view-content') ?? canvas.view.containerEl;
        const bar = host.createDiv({ cls: 'cmm-reading-bar' });
        focus.bar = bar;
        bar.createSpan({ text: t('聚焦：{title}', { title: state.title || t('无标题') }) });
        const select = bar.createEl('select', { attr: { 'aria-label': t('其他分支的显示方式') } });
        select.createEl('option', { text: t('临时隐藏其他分支'), value: 'hide' });
        select.createEl('option', { text: t('淡化其他分支'), value: 'dim' });
        select.value = focus.mode;
        select.addEventListener('change', () => {
            focus.mode = select.value === 'dim' ? 'dim' : 'hide';
            this.plugin.settings.focusMode = focus.mode;
            void this.plugin.saveSettings(); this.applyFocusLayout(canvas, true);
        });
        const compactLabel = bar.createEl('label', { cls: 'cmm-focus-compact' });
        const compact = compactLabel.createEl('input', { attr: { type: 'checkbox' } });
        compact.checked = focus.compact;
        compactLabel.appendText(t('紧凑布局'));
        compact.addEventListener('change', () => { focus.compact = compact.checked; this.applyFocusLayout(canvas, true); });
        const exit = bar.createEl('button', { text: t('退出聚焦') });
        exit.addEventListener('click', () => this.exitFocus(canvas));
        const search = bar.createEl('button', { text: t('搜索标题') });
        search.addEventListener('click', () => this.search(canvas, focus.id));
        for (const type of ['pointerdown', 'dblclick', 'wheel']) bar.addEventListener(type, event => event.stopPropagation());
    }

    private restoreFocusGeometry(data: CanvasData, focus: ReadingFocus): void {
        for (const node of data.nodes) {
            const position = focus.positions.get(node.id);
            if (position) { node.x = position.x; node.y = position.y; }
            else focus.positions.set(node.id, { x: node.x, y: node.y });
        }
        for (const edge of data.edges) {
            const original = focus.edges.get(edge.id);
            if (original) { edge.fromSide = original.fromSide; edge.toSide = original.toSide; }
            else focus.edges.set(edge.id, { fromSide: edge.fromSide, toSide: edge.toSide });
        }
    }

    private applyFocusLayout(canvas: Canvas, zoom: boolean): void {
        const focus = this.reading.get(canvas);
        if (!focus || this.stopped) return;
        const data = this.readData(canvas);
        this.restoreFocusGeometry(data, focus);
        let moved = new Set<string>();
        try {
            if (focus.compact) moved = layoutFocusedSubtree(data, { focusId: focus.id, mode: focus.mode });
            for (const node of data.nodes) {
                const state = meta(node), saved = focus.savedExpanded.get(node.id);
                if (state?.rootId === focus.rootId && saved !== undefined) state.expanded = saved;
            }
            canvas.view.containerEl.classList.toggle('cmm-focus-layout', focus.compact && moved.size <= 200);
            const alreadyProjecting = this.projecting.has(canvas);
            this.projecting.add(canvas);
            try { canvas.importData(data); } finally { if (!alreadyProjecting) this.projecting.delete(canvas); }
            this.render(canvas, false); this.schedule(canvas);
            if (zoom) {
                const projected = this.readData(canvas);
                const ids = [focus.id, ...descendants(treeNodes(projected, focus.rootId), focus.id).map(node => node.id)];
                this.zoomNodes(canvas, ids, focus.id);
            }
        } catch (error) {
            console.error('Canvas Mind Map: focus layout failed', error);
            this.restoreFocusGeometry(data, focus);
            for (const node of data.nodes) {
                const state = meta(node), saved = focus.savedExpanded.get(node.id);
                if (state?.rootId === focus.rootId && saved !== undefined) state.expanded = saved;
            }
            const alreadyProjecting = this.projecting.has(canvas);
            this.projecting.add(canvas);
            try { canvas.importData(data); } finally { if (!alreadyProjecting) this.projecting.delete(canvas); }
            focus.compact = false;
            canvas.view.containerEl.classList.remove('cmm-focus-layout');
            new Notice(t('聚焦布局失败，已恢复原位置。'));
        }
    }

    private exitFocus(canvas: Canvas): void {
        const focus = this.reading.get(canvas);
        if (!focus) return;
        const persistent = this.persistentData(canvas, JSON.parse(JSON.stringify(canvas.getData())) as CanvasData, false);
        this.reading.delete(canvas); focus.bar?.remove();
        const alreadyProjecting = this.projecting.has(canvas);
        this.projecting.add(canvas);
        try { canvas.importData(persistent); } finally { if (!alreadyProjecting) this.projecting.delete(canvas); }
        const container = canvas.view.containerEl;
        container.ownerDocument.defaultView?.setTimeout(() => container.classList.remove('cmm-focus-layout'), 220);
        this.render(canvas, false); this.schedule(canvas);
        canvas.deselectAll();
        for (const id of focus.selection) {
            const node = canvas.nodes.get(id);
            if (node) canvas.select(node);
        }
        canvas.setViewport(focus.viewport.x, focus.viewport.y, focus.viewport.zoom);
    }

    private overview(canvas: Canvas, id: string): void {
        this.exitFocus(canvas);
        const node = canvas.nodes.get(id), state = node && meta(node.getData());
        if (state) this.zoomNodes(canvas, treeNodes(canvas.getData(), state.rootId).map(node => node.id), state.rootId);
    }

    private search(canvas: Canvas, id: string): void {
        const node = canvas.nodes.get(id), state = node && meta(node.getData());
        if (!state) return;
        const feature = this;
        const items = treeNodes(canvas.getData(), state.rootId).map(node => {
            const state = meta(node)!;
            let path = state.title;
            try { path = state.key.split('/').filter(Boolean).map(part => decodeURIComponent(part.replace(/:\d+$/, ''))).join(' › ') || state.title; } catch { /* External metadata may not be URI encoded. */ }
            return { id: node.id, label: path };
        });
        const dialog = new class extends FuzzySuggestModal<{ id: string; label: string }> {
            getItems() { return items; }
            getItemText(item: { label: string }) { return item.label; }
            onChooseItem(item: { id: string }) { feature.run(() => feature.revealResult(canvas, item.id)); }
        }(this.plugin.app);
        dialog.setPlaceholder(t('搜索标题或章节路径（包含折叠节点）')); dialog.open();
    }

    private revealResult(canvas: Canvas, id: string): void {
        if (this.stopped) return;
        this.exitFocus(canvas);
        const data = this.readData(canvas), lookup = new Map(data.nodes.map(node => [node.id, node]));
        const node = lookup.get(id), state = node && meta(node);
        if (!state) { new Notice(t('该标题已不存在，请重新搜索。')); return; }
        const before = hiddenNodes(data.nodes);
        if (canvas.readonly && before.has(id)) { new Notice(t('画布为只读，无法展开折叠路径。')); return; }
        let parentId = state.parentId;
        const seen = new Set([id]);
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = lookup.get(parentId), parentState = parent && meta(parent);
            if (!parentState || parentState.rootId !== state.rootId) break;
            parentState.expanded = true; parentId = parentState.parentId;
        }
        const after = hiddenNodes(data.nodes), revealed = new Set([...before].filter(id => !after.has(id)));
        if (revealed.size) {
            this.placementAnchors.set(canvas, state.rootId);
            placeNodes(data, state.rootId, revealed, state.rootId);
            this.commit(canvas, data, revealed);
            this.placementAnchors.set(canvas, id);
        }
        this.zoomNodes(canvas, [id], id);
    }

    /** Replace the source preview with a compact center; preserve note content in metadata. */
    private compactRoot(data: CanvasData, rootId: string, raw: string, canvasPath: string): string {
        const root = data.nodes.find(node => node.id === rootId)!;
        const state = meta(root)!;
        if (state.compact) return rootId;
        const children = treeNodes(data, rootId).filter(node => meta(node)!.parentId === rootId);
        const promoted = children.length === 1 ? children[0] : undefined;
        const title = promoted ? meta(promoted)!.title : state.title;
        const id = randomId(), style = this.style(0);
        const file = root.type === 'file' ? root.file : undefined;
        const sourceFile = file ? this.plugin.app.vault.getFileByPath(file) : null;
        const label = sourceFile ? this.plugin.app.fileManager.generateMarkdownLink(sourceFile, canvasPath, promoted ? `#${title}` : '', title) : title;
        const text = `**${label}**`;
        const center: AllCanvasNodeData = { type: 'text', id, text,
            x: (promoted ?? root).x, y: (promoted ?? root).y,
            width: style.width, height: style.height, color: root.color ?? style.color,
            [MINDMAP_KEY]: { ...state, nodeId: id, rootId: id, title, compact: true,
                source: file ? { file } : { text: raw }, style, overrides: {}, generatedText: text,
                applied: { width: style.width, height: style.height, color: root.color ?? style.color } } as MindmapMeta };
        const replaced = new Set([rootId, ...(promoted ? [promoted.id] : [])]);
        data.nodes = data.nodes.filter(node => !replaced.has(node.id));
        data.nodes.push(center);
        for (const node of data.nodes) {
            const current = meta(node);
            if (!current || current.rootId !== rootId) continue;
            current.rootId = id;
            if (current.parentId && replaced.has(current.parentId)) current.parentId = id;
            if (promoted) { current.depth--; applyStyle(node, this.style(current.depth)); }
            current.placed = false;
        }
        data.edges = data.edges.filter(edge => !(edge.canvasMindMapRoot === rootId && replaced.has(edge.fromNode) && replaced.has(edge.toNode)));
        for (const edge of data.edges) {
            if (replaced.has(edge.fromNode)) edge.fromNode = id;
            if (replaced.has(edge.toNode)) edge.toNode = id;
            if (edge.canvasMindMapRoot === rootId) edge.canvasMindMapRoot = id;
        }
        return id;
    }

    private async relayout(canvas: Canvas, id: string, layout?: MindmapLayout): Promise<void> {
        const live = canvas.nodes.get(id);
        const rootId = live && meta(live.getData())?.rootId;
        const root = rootId && canvas.nodes.get(rootId);
        if (!root || canvas.readonly) return;
        const snapshot = JSON.stringify(canvas.getData());
        const raw = meta(root.getData())?.compact ? '' : await this.source(root);
        if (JSON.stringify(canvas.getData()) !== snapshot) return;
        const data = this.readData(canvas), selected = data.nodes.find(node => node.id === id);
        const state = selected && meta(selected);
        if (!state) return;
        const centerId = this.compactRoot(data, state.rootId, raw, canvas.view.file.path);
        const nodes = treeNodes(data, centerId);
        if (layout) meta(nodes.find(node => node.id === centerId)!)!.layout = layout;
        assignAngles(nodes, centerId);
        for (const node of nodes) if (node.id !== centerId) meta(node)!.placed = false;
        const movable = new Set(nodes.filter(node => node.id !== centerId).map(node => node.id));
        placeNodes(data, centerId, movable);
        this.placementAnchors.set(canvas, centerId);
        this.commit(canvas, data, movable);
        this.center(canvas, centerId);
    }

    private applyTemplate(canvas: Canvas, id: string): void {
        const data = this.readData(canvas), selected = data.nodes.find(node => node.id === id);
        const state = selected && meta(selected);
        if (!state) return;
        for (const node of treeNodes(data, state.rootId)) applyStyle(node, this.style(meta(node)!.depth));
        this.commit(canvas, data);
        new Notice(t('已应用层级模板，保留单节点覆盖。'));
    }

    private styleDialog(canvas: Canvas, id: string): void {
        const node = canvas.nodes.get(id)?.getData(), state = node && meta(node);
        if (!state || !node) return;
        const style = { ...state.style, width: node.width, height: node.height, color: node.color ?? '',
            autoHeight: state.style.autoHeight && !state.overrides?.height && node.height === state.applied.height };
        const dialog = new Modal(this.plugin.app);
        dialog.setTitle(t('此节点的外观'));
        styleFields(dialog.contentEl, style, () => {});
        new Setting(dialog.contentEl).addButton(button => button.setButtonText(t('保存')).setCta().onClick(() => {
            const data = this.readData(canvas), current = data.nodes.find(item => item.id === id);
            const currentState = current && meta(current);
            if (current && currentState) {
                currentState.style = { ...style };
                currentState.overrides = { width: true, height: !style.autoHeight, color: true, autoHeight: true };
                current.width = style.width; current.height = style.height; current.color = style.color;
                currentState.applied = { width: style.width, height: style.height, color: style.color };
                this.commit(canvas, data);
            }
            dialog.close();
        })).addButton(button => button.setButtonText(t('恢复层级模板')).onClick(() => {
            const data = this.readData(canvas), current = data.nodes.find(item => item.id === id);
            const currentState = current && meta(current);
            if (current && currentState) {
                currentState.overrides = {};
                currentState.applied = { width: current.width, height: current.height, color: current.color ?? '' };
                applyStyle(current, this.style(currentState.depth));
                this.commit(canvas, data);
            }
            dialog.close();
        }));
        dialog.open();
    }

    private async refresh(canvas: Canvas, id: string): Promise<void> {
        if (this.refreshing.has(canvas) || canvas.readonly) return;
        this.refreshing.add(canvas);
        try {
            const selected = canvas.nodes.get(id)?.getData(), state = selected && meta(selected);
            const root = state && canvas.nodes.get(state.rootId);
            if (!root || !state) { new Notice(t('中心节点已不存在，无法刷新。')); return; }
            const raw = await this.source(root);
            if (this.stopped || canvas.readonly || canvas.nodes.get(root.id) !== root || !meta(root.getData())) return;
            const snapshot = JSON.stringify(canvas.getData());
            const data: CanvasData = JSON.parse(snapshot);
            const rootMeta = meta(data.nodes.find(node => node.id === root.id)!)!;
            const fresh = this.makeNodes(canvas, root, raw, rootMeta.mode);
            const previous = treeNodes(data, root.id).filter(node => node.id !== root.id);
            const oldByKey = new Map(previous.map(node => [meta(node)!.key, node]));
            // Duplicate titles have no stable heading identifier in Markdown. Treat as ambiguous.
            const counts = (nodes: AllCanvasNodeData[]) => {
                const result = new Map<string, number>();
                for (const node of nodes) result.set(meta(node)!.title, (result.get(meta(node)!.title) ?? 0) + 1);
                return result;
            };
            const oldCounts = counts(previous), newCounts = counts(fresh);
            const replacements = new Map<string, string>(), retained = new Set<string>();
            for (const node of fresh) {
                const current = meta(node)!;
                const old = oldByKey.get(current.key);
                if (old && oldCounts.get(current.title) === 1 && newCounts.get(current.title) === 1) {
                    replacements.set(node.id, old.id); retained.add(old.id);
                }
            }
            const removed = previous.filter(node => !retained.has(node.id));
            const added = fresh.filter(node => !replacements.has(node.id));
            if (removed.length) {
                const removedIds = new Set(removed.map(node => node.id));
                const externalEdges = data.edges.filter(edge => edge.canvasMindMapRoot !== root.id &&
                    (removedIds.has(edge.fromNode) || removedIds.has(edge.toNode))).length;
                const accepted = await this.confirmRefresh(removed, added, externalEdges);
                if (!accepted) return;
            }
            const currentSource = await this.source(root);
            if (this.stopped || canvas.readonly || canvas.nodes.get(root.id) !== root || JSON.stringify(canvas.getData()) !== snapshot || currentSource !== raw) {
                new Notice(t('画布或原文已发生变化，请重新执行刷新。')); return;
            }
            const generatedIds = new Map(fresh.map(node => [node.id, replacements.get(node.id) ?? node.id]));
            const nextNodes = fresh.map(node => {
                const nextMeta = meta(node)!;
                const parentId = generatedIds.get(nextMeta.parentId!) ?? root.id;
                const oldId = replacements.get(node.id);
                if (!oldId) { nextMeta.parentId = parentId; nextMeta.expanded = false; return node; }
                const old = previous.find(item => item.id === oldId)!;
                captureOverrides(old);
                const oldMeta = meta(old)!;
                // Preserve edited text cards. File nodes continue to embed the current source.
                if (old.type === 'text' && node.type === 'text' && old.text === oldMeta.generatedText) old.text = node.text;
                if (old.type === 'file' && node.type === 'file') { old.file = node.file; old.subpath = node.subpath; }
                oldMeta.generatedText = nextMeta.generatedText;
                oldMeta.parentId = parentId; oldMeta.depth = nextMeta.depth;
                oldMeta.key = nextMeta.key; oldMeta.title = nextMeta.title;
                return old;
            });
            const oldIds = new Set(previous.map(node => node.id));
            const removedIds = new Set(removed.map(node => node.id));
            const oldEdges = data.edges.filter(edge => edge.canvasMindMapRoot === root.id);
            data.nodes = data.nodes.filter(node => !oldIds.has(node.id)).concat(nextNodes);
            data.edges = data.edges.filter(edge => edge.canvasMindMapRoot !== root.id &&
                !removedIds.has(edge.fromNode) && !removedIds.has(edge.toNode));
            for (const node of nextNodes) {
                const parentId = meta(node)!.parentId!;
                const existing = oldEdges.find(edge => edge.fromNode === parentId && edge.toNode === node.id);
                data.edges.push(existing ?? treeEdge(randomId(), root.id, parentId, node.id));
            }
            assignAngles(treeNodes(data, root.id), root.id);
            placeNodes(data, root.id, new Set(added.map(node => node.id)));
            this.commit(canvas, data, new Set(added.map(node => node.id)));
            if (!canvas.selection.size) this.center(canvas, root.id);
            new Notice(t('刷新完成：保留 {retained}，新增 {added}，移除 {removed} 个标题节点。',
                { retained: retained.size, added: added.length, removed: removed.length }));
        } finally { this.refreshing.delete(canvas); }
    }

    private confirmRefresh(removed: AllCanvasNodeData[], added: AllCanvasNodeData[], edges: number): Promise<boolean> {
        return new Promise(resolve => {
            const dialog = new Modal(this.plugin.app);
            let confirmed = false;
            dialog.setTitle(t('确认标题结构变更'));
            dialog.contentEl.createEl('p', { text: t('以下旧标题无法可靠匹配（可能已改名、移动、删除或重名）。刷新将移除这些卡片及其连线，包括 {edges} 条额外连接。取消可保留当前导图。', { edges }) });
            const list = dialog.contentEl.createDiv({ cls: 'cmm-mindmap-change-list' });
            list.createEl('h3', { text: t('移除 {count} 个旧节点', { count: removed.length }) });
            for (const node of removed) {
                const state = meta(node)!;
                let label = state.title || t('无标题');
                try {
                    label = state.key.split('/').slice(1).map(part => decodeURIComponent(part.replace(/:\d+$/, '')) || t('无标题')).join(' › ');
                } catch { /* Keep the readable title if external metadata has an invalid key. */ }
                list.createEl('p', { text: label });
            }
            list.createEl('h3', { text: t('新增 {count} 个节点', { count: added.length }) });
            for (const node of added) list.createEl('p', { text: meta(node)!.title || t('无标题') });
            new Setting(dialog.contentEl)
                .addButton(button => button.setButtonText(t('取消')).onClick(() => dialog.close()))
                .addButton(button => button.setButtonText(t('确认刷新')).setWarning().onClick(() => { confirmed = true; dialog.close(); }));
            dialog.onClose = () => { dialog.contentEl.empty(); resolve(confirmed); };
            dialog.open();
        });
    }

    private isHidden(item: CanvasNode | CanvasEdge, hidden: Set<string>): boolean {
        return 'from' in item ? hidden.has(item.from.node.id) || hidden.has(item.to.node.id) : hidden.has(item.id);
    }

    private schedule(canvas: Canvas): void {
        if (this.stopped || this.frames.has(canvas)) return;
        const win = canvas.view?.containerEl?.ownerDocument.defaultView;
        if (!win) return;
        const id = win.requestAnimationFrame(() => {
            this.frames.delete(canvas);
            if (!this.stopped && canvas.view.containerEl.isConnected) this.render(canvas);
        });
        this.frames.set(canvas, { win, id });
    }

    private clearDisplay(canvas: Canvas): void {
        if (this.reading.has(canvas)) this.exitFocus(canvas);
        for (const node of canvas.nodes.values()) {
            node.nodeEl.classList.remove(HIDDEN, DIM);
            this.previewSizes.delete(node);
            this.refreshPreview(node, false);
            node.nodeEl.querySelector(`.${BUTTON}`)?.remove();
        }
        for (const edge of canvas.edges.values()) { this.hideEdge(edge, false); this.dimEdge(edge, false); }
    }

    private dimEdge(edge: CanvasEdge, dim: boolean): void {
        for (const element of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement?.wrapperEl]) element?.classList.toggle(DIM, dim);
    }

    private hideEdge(edge: CanvasEdge, hidden: boolean): void {
        for (const element of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement?.wrapperEl]) element?.classList.toggle(HIDDEN, hidden);
    }

    private unobserve(node: CanvasNode): void {
        const observer = this.observers.get(node);
        observer?.mutation.disconnect(); observer?.resize?.disconnect();
        this.observers.delete(node);
    }

    private observeContent(node: CanvasNode, enabled: boolean): void {
        const content = enabled ? node.nodeEl.querySelector<HTMLElement>('.canvas-node-content') : null;
        const previous = this.observers.get(node);
        if (previous?.content === content) return;
        this.unobserve(node);
        const win = content?.ownerDocument.defaultView;
        if (!content || !win) return;
        const changed = () => this.schedule(node.canvas);
        const mutation = new win.MutationObserver(changed);
        mutation.observe(content, { childList: true, subtree: true, characterData: true });
        const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(changed) : undefined;
        resize?.observe(content);
        this.observers.set(node, { content, mutation, resize });
    }

    /** CSS folding bypasses Obsidian's mount/resize notifications. Wake its virtual
     * Markdown preview once it has visible dimensions again, even for fixed-height cards. */
    private refreshPreview(node: CanvasNode, hidden: boolean): void {
        if (hidden) { this.previewSizes.delete(node); return; }
        const renderer = node.child?.previewMode?.renderer;
        const preview = renderer?.previewEl;
        if (!renderer || !preview || !preview.isConnected) return;
        const width = preview.offsetWidth, height = preview.clientHeight;
        if (width <= 0 || height <= 0) { this.previewSizes.delete(node); return; }
        const previous = this.previewSizes.get(node);
        if (previous?.renderer === renderer && previous.width === width && previous.height === height) return;
        // Cache first: onResize may cause DOM mutations and schedule another frame.
        this.previewSizes.set(node, { renderer, width, height });
        renderer.onResize();
    }

    private render(canvas: Canvas, measure = true): void {
        if (this.stopped) return;
        const data = this.readingData(canvas, canvas.getData());
        const focus = this.reading.get(canvas);
        if (focus && !data.nodes.some(node => node.id === focus.id && meta(node)?.rootId === focus.rootId)) {
            this.exitFocus(canvas); return;
        }
        const { hidden, dim } = this.displayState(canvas, data);
        for (const node of this.observers.keys()) {
            if (node.canvas === canvas && (canvas.nodes.get(node.id) !== node || !node.nodeEl.isConnected)) this.unobserve(node);
        }
        const children = new Map<string, AllCanvasNodeData[]>();
        for (const node of data.nodes) {
            const parent = meta(node)?.parentId;
            if (parent) children.set(parent, [...(children.get(parent) ?? []), node]);
        }
        const counts = new Map<string, number>();
        const countHidden = (id: string, seen = new Set<string>()): number => {
            if (counts.has(id)) return counts.get(id)!;
            if (seen.has(id)) return 0;
            seen.add(id);
            const count = (children.get(id) ?? []).reduce((sum, child) => sum + Number(hidden.has(child.id)) + countHidden(child.id, seen), 0);
            counts.set(id, count); return count;
        };
        for (const nodeData of data.nodes) {
            const node = canvas.nodes.get(nodeData.id);
            if (!node) continue;
            node.nodeEl.classList.toggle(HIDDEN, hidden.has(node.id));
            node.nodeEl.classList.toggle(DIM, dim.has(node.id));
            const state = meta(nodeData);
            if (state && (measure || hidden.has(node.id))) this.refreshPreview(node, hidden.has(node.id));
            const autoHeight = !!state?.style.autoHeight && !state.overrides?.height && node.height === state.applied.height;
            if (state && !autoHeight) node.autoHeightEnabled = false;
            this.observeContent(node, !!state && !hidden.has(node.id) && node.nodeEl.isConnected);
            let button = node.nodeEl.querySelector<HTMLButtonElement>(`.${BUTTON}`);
            if (!state || !children.has(node.id)) { button?.remove(); continue; }
            if (!button) {
                button = node.nodeEl.ownerDocument.createElement('button');
                button.className = BUTTON;
                button.type = 'button';
                // Bound to this node's document, including popped-out windows.
                button.addEventListener('pointerdown', event => event.stopPropagation());
                button.addEventListener('dblclick', event => { event.stopPropagation(); event.preventDefault(); });
                button.addEventListener('click', event => {
                    event.stopPropagation(); event.preventDefault();
                    const latest = meta(node.getData());
                    const expanded = this.reading.get(canvas)?.expanded.get(node.id) ?? latest?.expanded;
                    if (latest && !canvas.readonly) this.run(() => this.fold(canvas, node.id, !expanded));
                });
                node.nodeEl.appendChild(button);
            }
            const count = countHidden(node.id);
            const label = `${state.expanded ? '−' : '+'}${count ? ` ${count}` : ''}`;
            if (button.textContent !== label) button.textContent = label;
            button.disabled = canvas.readonly;
            button.setAttribute('aria-expanded', String(state.expanded));
            const action = t(state.expanded ? '收起分支' : '展开下一级');
            const descendantsLabel = t('{count} 个隐藏后代', { count });
            button.setAttribute('aria-label', `${action}, ${descendantsLabel}`);
            button.title = `${action} · ${descendantsLabel}`;
        }
        for (const edge of canvas.edges.values()) {
            this.hideEdge(edge, this.isHidden(edge, hidden)); this.dimEdge(edge, this.isHidden(edge, dim));
        }
        for (const item of Array.from(canvas.selection) as (CanvasNode | CanvasEdge)[]) {
            if (this.isHidden(item, hidden)) canvas.deselect(item);
        }
        // Auto-height uses the native measurement, after Markdown has rendered. Never
        // writes hidden nodes or overwrites a manual resize. Metadata follows the fit.
        const fittedRoots = new Set<string>();
        const fittedNodes = new Set<string>();
        const ready = new Set<string>();
        if (measure && !canvas.readonly) for (const nodeData of data.nodes) {
            const state = meta(nodeData), node = canvas.nodes.get(nodeData.id);
            if (!state || !node || hidden.has(node.id) || !node.nodeEl.isConnected ||
                !state.style.autoHeight || state.overrides?.height || node.height !== state.applied.height) continue;
            const content = node.nodeEl.querySelector<HTMLElement>('.canvas-node-content');
            const preview = content?.querySelector<HTMLElement>('.markdown-preview-view') ?? content;
            if (preview?.childElementCount) ready.add(node.id);
            if (!preview || preview.scrollHeight <= preview.clientHeight + 1 || !node.onResizeDblclick) continue;
            const previousAutoHeight = node.autoHeightEnabled;
            this.fitting.add(canvas);
            try {
                node.onResizeDblclick({ preventDefault() {}, stopPropagation() {} }, 'bottom');
            } finally {
                node.autoHeightEnabled = previousAutoHeight;
                this.fitting.delete(canvas);
            }
            if (node.height !== state.applied.height) {
                // Read again because node.setData copies unknown fields in Canvas.
                const fitted: AllCanvasNodeData = JSON.parse(JSON.stringify(node.getData()));
                const fittedState = meta(fitted);
                if (fittedState) {
                    fittedState.applied = { ...fittedState.applied, height: node.height };
                    node.setData(fitted);
                    canvas.requestSave(false);
                    fittedRoots.add(fittedState.rootId);
                    fittedNodes.add(node.id);
                }
            }
        }
        // Async Markdown height changes must also reserve subtree space, including
        // images that finish loading after the initial placement queue has drained.
        const pending = this.pendingPlacement.get(canvas);
        if (fittedRoots.size) {
            const fittedData = this.readData(canvas);
            for (const rootId of fittedRoots) {
                const candidate = this.placementAnchors.get(canvas);
                const anchor = fittedData.nodes.find(node => node.id === candidate && meta(node)?.rootId === rootId);
                placeNodes(fittedData, rootId, new Set([...(pending ?? []), ...fittedNodes]), anchor?.id ?? rootId);
            }
            canvas.importData(this.persistentData(canvas, fittedData));
            canvas.requestSave(false);
            if (this.reading.get(canvas)?.compact) this.applyFocusLayout(canvas, false);
        }
        if (pending) {
            for (const id of pending) {
                const node = canvas.nodes.get(id), state = node && meta(node.getData());
                if (!state || hidden.has(id) || !state.style.autoHeight || ready.has(id)) pending.delete(id);
            }
            if (!pending.size) this.pendingPlacement.delete(canvas);
        }
    }
}

/** Shared by per-node editing and the global level templates. */
function styleFields(container: HTMLElement, style: MindmapLevelStyle, save: () => void): void {
    for (const key of ['width', 'height'] as const) new Setting(container)
        .setName(t(key === 'width' ? '宽度' : '高度（自动高度时作为初始值）'))
        .setDesc(t('画布单位，范围 50–5000。'))
        .addText(text => {
            text.setValue(String(style[key])).onChange(raw => {
                const value = Number(raw);
                const valid = Number.isInteger(value) && value >= 50 && value <= 5000;
                text.inputEl.setAttribute('aria-invalid', String(!valid));
                if (valid) { style[key] = value; save(); }
            });
            text.inputEl.type = 'number'; text.inputEl.min = '50'; text.inputEl.max = '5000';
        });
    new Setting(container).setName(t('自动高度')).setDesc(t('按内容增高；手动拖动高度后保留你的调整。'))
        .addToggle(toggle => toggle.setValue(style.autoHeight).onChange(value => { style.autoHeight = value; save(); }));
    new Setting(container).setName(t('背景颜色')).setDesc(t('留空使用默认颜色，1–6 使用画布颜色，或输入 #RRGGBB。'))
        .addText(text => text.setValue(style.color).setPlaceholder('#7c8cf8').onChange(raw => {
            const value = raw.trim(), valid = /^(|[1-6]|#[\da-fA-F]{6})$/.test(value);
            text.inputEl.setAttribute('aria-invalid', String(!valid));
            if (valid) { style.color = value; save(); }
        }));
}

export function normalizeMindmapLevels(value: unknown): MindmapLevelStyle[] {
    return DEFAULT_MINDMAP_LEVELS.map((fallback, depth) => {
        const input: Partial<MindmapLevelStyle> = Array.isArray(value) ? value[depth] ?? {} : {};
        const dimension = (number: unknown, backup: number) => typeof number === 'number' && Number.isInteger(number) && number >= 50 && number <= 5000 ? number : backup;
        return { width: dimension(input.width, fallback.width), height: dimension(input.height, fallback.height),
            autoHeight: typeof input.autoHeight === 'boolean' ? input.autoHeight : fallback.autoHeight,
            color: typeof input.color === 'string' && /^(|[1-6]|#[\da-fA-F]{6})$/.test(input.color) ? input.color : fallback.color };
    });
}

export function renderMindmapSettings(container: HTMLElement, plugin: CanvasMindMapPlugin): void {
    new Setting(container).setName(t('思维导图')).setHeading();
    new Setting(container).setName(t('语言')).setDesc(t('自动跟随 Obsidian；不支持的语言使用英语。'))
        .addDropdown(dropdown => dropdown.addOptions(languageOptions()).setValue(plugin.settings.language).onChange(async value => {
            plugin.settings.language = value === 'en' || value === 'zh-CN' ? value : 'auto';
            await plugin.saveSettings(); plugin.refreshLanguage();
            container.empty(); renderMindmapSettings(container, plugin);
            new Notice(t('语言已更新。重新加载插件后，命令面板中的名称也会更新。'));
        }));
    new Setting(container).setName(t('聚焦阅读')).setHeading();
    new Setting(container).setName(t('聚焦时优化子树布局'))
        .setDesc(t('临时紧凑排列当前可见后代；退出聚焦后恢复原位置。'))
        .addToggle(toggle => toggle.setValue(plugin.settings.compactFocus).onChange(value => {
            plugin.settings.compactFocus = value; void plugin.saveSettings();
        }));
    new Setting(container).setName(t('思维导图层级模板')).setHeading()
        .setDesc(t('按距离中心的实际层数设置。修改用于新节点；已有导图可通过右键应用模板。'));
    plugin.settings.mindmapLevels.forEach((style, depth) => {
        const details = container.createEl('details', { cls: 'cmm-mindmap-level-settings' });
        details.createEl('summary', { text: depth === 0 ? t('第 0 层 · 中心') : t('第 {depth} 层', { depth }) });
        styleFields(details, style, () => { void plugin.saveSettings(); });
    });
}
