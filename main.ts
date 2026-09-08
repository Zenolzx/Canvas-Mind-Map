import { Menu, Plugin, PluginSettingTab } from 'obsidian';
import { around } from 'monkey-around';
import type { CanvasNode, CanvasView } from './Canvas';
import { CanvasMindmap, normalizeMindmapLevels, renderMindmapSettings } from './src/CanvasMindmap';
import { LAYOUT_LABELS, MindmapSettings } from './src/settings';

export default class CanvasMindMapPlugin extends Plugin {
    settings: MindmapSettings;
    mindmap: CanvasMindmap;

    async onload(): Promise<void> {
        const saved = await this.loadData() ?? {};
        this.settings = {
            mindmapLevels: normalizeMindmapLevels(saved.mindmapLevels),
            lastMode: saved.lastMode === 'body' ? 'body' : 'title',
            focusMode: saved.focusMode === 'dim' ? 'dim' : 'hide',
            lastLayout: Object.prototype.hasOwnProperty.call(LAYOUT_LABELS, saved.lastLayout) ? saved.lastLayout : 'radial',
        };
        this.mindmap = new CanvasMindmap(this);
        this.mindmap.register();
        this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu) => this.mindmap.addSelectionMenu(menu)));
        this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu) => this.mindmap.addSelectionMenu(menu)));
        this.registerLazyPatcher(() => {
            const view = this.app.workspace.getLeavesOfType('canvas').find(leaf => (leaf.view as CanvasView).canvas?.nodes?.size)?.view as CanvasView | undefined;
            const node = view?.canvas.nodes.values().next().value;
            if (!node) return false;
            const prototype = Object.getPrototypeOf(Object.getPrototypeOf(node));
            if (!prototype?.showMenu) return false;
            const feature = this.mindmap;
            this.register(around(prototype, {
                showMenu: (next: (menu: Menu, ...args: unknown[]) => unknown) => function(this: CanvasNode, menu: Menu, ...args: unknown[]) {
                    const result = next.call(this, menu, ...args);
                    feature.addMenu(menu, this);
                    return result;
                },
            }));
            return true;
        });
        this.addSettingTab(new MindmapSettingTab(this));
    }

    registerLazyPatcher(patch: () => boolean): void {
        let patched = false;
        const attempt = () => {
            if (patched || !patch()) return;
            patched = true;
            this.app.workspace.offref(leafEvent);
            this.app.workspace.offref(layoutEvent);
        };
        const leafEvent = this.app.workspace.on('active-leaf-change', attempt);
        const layoutEvent = this.app.workspace.on('layout-change', attempt);
        this.registerEvent(leafEvent);
        this.registerEvent(layoutEvent);
        this.app.workspace.onLayoutReady(attempt);
        attempt();
    }

    async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

class MindmapSettingTab extends PluginSettingTab {
    constructor(private owner: CanvasMindMapPlugin) { super(owner.app, owner); }
    display(): void {
        this.containerEl.empty();
        renderMindmapSettings(this.containerEl, this.owner);
    }
}
