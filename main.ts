import { Menu, moment, Notice, Plugin, PluginSettingTab, TFile, TFolder } from 'obsidian';
import { ComposerStore } from './src/composer/ComposerStore';
import { COMPOSER_VIEW, ComposerView, showDrafts, showTemplates } from './src/composer/ComposerView';
import { around } from 'monkey-around';
import type { CanvasNode, CanvasView } from './Canvas';
import { CanvasMindmap, normalizeMindmapLevels, renderMindmapSettings } from './src/CanvasMindmap';
import { LAYOUT_LABEL_KEYS, MindmapSettings, normalizeOrganicSettings } from './src/settings';
import { PluginDataStore } from './src/PluginDataStore';
import { OrganicStateStore } from './src/organic/OrganicStateStore';
import { renderOrganicSettings } from './src/organic/OrganicSettings';
import { setLanguage, t } from './src/i18n';
import { ORGANIC_VIEW, OrganicMindMapView } from './src/organic/OrganicMindMapView';
import { ObsidianDocumentHost } from './src/writing/ObsidianDocumentHost';

export default class CanvasMindMapPlugin extends Plugin {
    settings: MindmapSettings;
    mindmap: CanvasMindmap;
    organicStates: OrganicStateStore;
    composerDrafts: ComposerStore;
    private dataStore: PluginDataStore;

    async onload(): Promise<void> {
        const saved = await this.loadData() ?? {};
        this.settings = {
            organic: normalizeOrganicSettings(saved.organic),
            mindmapLevels: normalizeMindmapLevels(saved.mindmapLevels),
            lastMode: saved.lastMode === 'body' ? 'body' : 'title',
            focusMode: saved.focusMode === 'dim' ? 'dim' : 'hide',
            compactFocus: saved.compactFocus !== false,
            language: saved.language === 'en' || saved.language === 'zh-CN' ? saved.language : 'auto',
            lastLayout: Object.prototype.hasOwnProperty.call(LAYOUT_LABEL_KEYS, saved.lastLayout) ? saved.lastLayout : 'horizontal',
        };
        this.dataStore = new PluginDataStore(() => ({ ...saved, ...this.settings, organicState: this.organicStates.data, composerDrafts: this.composerDrafts.persisted, composerPreferences: this.composerDrafts.preferences }), data => this.saveData(data));
        this.composerDrafts = new ComposerStore(saved.composerDrafts, () => this.dataStore.save(), saved.composerPreferences);
        this.organicStates = new OrganicStateStore(saved.organicState, () => this.dataStore.save(), () => this.settings.organic.rememberState,
            error => { console.error('Organic state save failed', error); new Notice(t('Organic 状态保存失败，请查看控制台。')); });
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.organicStates.rename(oldPath, file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(ORGANIC_VIEW))
                (leaf.view as OrganicMindMapView).sourceRenamed(oldPath, file.path);
        }));
        this.registerEvent(this.app.vault.on('delete', file => {
            this.organicStates.remove(file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(ORGANIC_VIEW))
                (leaf.view as OrganicMindMapView).sourceDeleted(file.path);
        }));
        this.register(() => { void this.organicStates.flush().catch(console.error); });
        setLanguage(this.settings.language, moment.locale());
        const documentHost = new ObsidianDocumentHost(this.app);
        this.register(() => documentHost.dispose());
        this.registerEditorExtension(documentHost.extension);
        this.registerView(ORGANIC_VIEW, leaf => new OrganicMindMapView(leaf, this.organicStates, () => this.settings.organic, documentHost));
        this.registerView(COMPOSER_VIEW, leaf => new ComposerView(leaf, this.composerDrafts));
        const openComposer = async (draftId?: string, targetFolder?: string) => {
            const existing = draftId && this.app.workspace.getLeavesOfType(COMPOSER_VIEW).find(leaf => leaf.view.getState().draftId === draftId);
            if (existing) { await this.app.workspace.revealLeaf(existing); return; }
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: COMPOSER_VIEW, active: true, state: { draftId, targetFolder } });
            (leaf.view as ComposerView).focusMap();
        };
        this.addRibbonIcon('file-plus-2', 'New Mind Map Document', () => { void openComposer(); });
        this.addCommand({ id: 'new-mind-map-document', name: 'New Mind Map Document', callback: () => { void openComposer(); } });
        this.addCommand({ id: 'restore-composer-draft', name: 'Restore Composer Draft', callback: () => showDrafts(this.app, this.composerDrafts, id => openComposer(id)) });
        this.addCommand({ id: 'composer-from-template', name: 'New Composer from template', callback: () => showTemplates(this.app, draft => {
            this.composerDrafts.put({ ...draft, ...this.composerDrafts.preferences });
            void this.composerDrafts.flush().then(() => openComposer(draft.draftId)).catch(error => new Notice(String(error)));
        }) });
        this.addCommand({ id: 'search-composer', name: 'Composer: Search', checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(ComposerView); if (!view) return false;
            if (!checking) view.openSearch(); return true;
        } });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (file instanceof TFolder) menu.addItem(item => item.setTitle('New Mind Map Document here').setIcon('file-plus-2').onClick(() => openComposer(undefined, file.path)));
        }));
        this.register(() => { void this.composerDrafts.flush().catch(console.error); });
        this.addCommand({ id: 'toggle-mind-map-writing', name: 'Organic: Toggle Mind Map Writing', checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(OrganicMindMapView);
            if (!view) return false; if (!checking) void view.toggleWriting(); return true;
        } });
        for (const command of ['rename', 'sibling', 'child', 'promote', 'demote', 'delete', 'undo', 'redo', 'editor'] as const) {
            this.addCommand({ id: `mind-map-writing-${command}`, name: `Mind Map Writing: ${command}`, checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(OrganicMindMapView);
                if (!view?.isWriting) return false; if (!checking) view.writingCommand(command); return true;
            } });
        }
        this.addCommand({ id: 'search-organic-headings', name: t('Organic：搜索标题'), checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(OrganicMindMapView);
            if (!view) return false; if (!checking) view.openSearch(); return true;
        } });
        this.addCommand({ id: 'refresh-organic-mind-map', name: t('Organic：从原笔记刷新'), checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(OrganicMindMapView);
            if (!view) return false; if (!checking) void view.refresh(); return true;
        } });
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

    async saveSettings(): Promise<void> { await this.dataStore.save(); }

    private async openOrganic(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: ORGANIC_VIEW, active: true, state: { file: file.path } });
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
        renderMindmapSettings(this.containerEl, this.owner, () => this.display());
        renderOrganicSettings(this.containerEl, this.owner);
    }
}
