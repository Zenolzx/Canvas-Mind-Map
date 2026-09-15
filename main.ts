import { Menu, moment, Plugin, PluginSettingTab, TFile } from 'obsidian';
import { around } from 'monkey-around';
import type { CanvasNode, CanvasView } from './Canvas';
import { CanvasMindmap, normalizeMindmapLevels, renderMindmapSettings } from './src/CanvasMindmap';
import { LAYOUT_LABEL_KEYS, MindmapSettings } from './src/settings';
import { setLanguage, t } from './src/i18n';
import { ORGANIC_VIEW, OrganicMindMapView } from './src/organic/OrganicMindMapView';

export default class CanvasMindMapPlugin extends Plugin {
    settings: MindmapSettings;
    mindmap: CanvasMindmap;

    async onload(): Promise<void> {
        const saved = await this.loadData() ?? {};
        this.settings = {
            mindmapLevels: normalizeMindmapLevels(saved.mindmapLevels),
            lastMode: saved.lastMode === 'body' ? 'body' : 'title',
            focusMode: saved.focusMode === 'dim' ? 'dim' : 'hide',
            compactFocus: saved.compactFocus !== false,
            language: saved.language === 'en' || saved.language === 'zh-CN' ? saved.language : 'auto',
            lastLayout: Object.prototype.hasOwnProperty.call(LAYOUT_LABEL_KEYS, saved.lastLayout) ? saved.lastLayout : 'horizontal',
        };
        setLanguage(this.settings.language, moment.locale());
        this.registerView(ORGANIC_VIEW, leaf => new OrganicMindMapView(leaf));
        this.addCommand({ id: 'open-organic-mind-map', name: t('以 Organic 模式打开笔记'),
            checkCallback: checking => {
                const file = this.app.workspace.getActiveFile();
                if (file?.extension !== 'md') return false;
                if (!checking) void this.openOrganic(file);
                return true;
            },
        });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item
                .setTitle(t('以 Organic 模式打开笔记')).setIcon('git-fork').onClick(() => this.openOrganic(file)));
        }));
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

    private async openOrganic(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: ORGANIC_VIEW, active: true });
        if (leaf.view instanceof OrganicMindMapView) await leaf.view.loadSource(file);
    }

    refreshLanguage(): void {
        setLanguage(this.settings.language, moment.locale());
        this.mindmap.refreshLanguage();
    }
}

class MindmapSettingTab extends PluginSettingTab {
    constructor(private owner: CanvasMindMapPlugin) { super(owner.app, owner); }
    display(): void {
        this.containerEl.empty();
        renderMindmapSettings(this.containerEl, this.owner);
    }
}
