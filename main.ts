import { AppearancePicker } from './src/appearance/AppearancePicker';
import { Menu, moment, Notice, Plugin, PluginSettingTab, TFile, TFolder } from 'obsidian';
import { ComposerStore } from './src/composer/ComposerStore';
import { COMPOSER_VIEW, ComposerView, showDrafts, showTemplates } from './src/composer/ComposerView';
import { watchCanvasIntegration } from './src/native/DeferredCanvasIntegration';
import { EnhancedCanvasInterop } from './src/native/EnhancedCanvasInterop';
import { CanvasMindmap, normalizeMindmapLevels, renderMindmapSettings } from './src/CanvasMindmap';
import { LAYOUT_LABEL_KEYS, MindmapLayout, MindmapSettings, normalizeAppearancePreset, normalizeBranchColourMode, normalizeMindmapTypeface, normalizeOrganicSettings, normalizeSurfaceMaterial } from './src/settings';
import { PluginDataStore } from './src/PluginDataStore';
import { OrganicStateStore } from './src/organic/OrganicStateStore';
import { renderOrganicSettings } from './src/organic/OrganicSettings';
import { setLanguage, t, ct } from './src/i18n';
import { ORGANIC_VIEW, OrganicMindMapView } from './src/organic/OrganicMindMapView';
import { supportedSource } from './src/formats/SourceFormats';
import { ObsidianDocumentHost } from './src/writing/ObsidianDocumentHost';

export default class CanvasMindMapPlugin extends Plugin {
    // Assigned in onload(). Obsidian does not run the constructor itself, so these cannot be
    // field initialisers; the definite-assignment modifier records that onload always sets them
    // before any of the API surface can be reached.
    settings!: MindmapSettings;
    mindmap!: CanvasMindmap;
    organicStates!: OrganicStateStore;
    composerDrafts!: ComposerStore;
    private dataStore!: PluginDataStore;
    private appearanceApplied = new WeakMap<HTMLElement, string>();
    private enhancedInterop?: EnhancedCanvasInterop;
    refreshEnhancedCompatibility(): void { this.enhancedInterop?.refresh(); }
    /** Tracks the undocumented Canvas prototype hooks, which can silently fail to install. */
    private patchState: { total: number; landed: number } = { total: 0, landed: 0 };

    private openAppearance(target: HTMLElement): void {
        const initial = { appearance: this.settings.appearance, surfaceMaterial: this.settings.surfaceMaterial };
        const restore = () => { this.appearanceApplied.delete(target); this.applyAppearance(target); };
        new AppearancePicker(this.app, target, initial, async choice => {
            const previous = { ...initial };
            Object.assign(this.settings, choice);
            try { await this.saveSettings(); this.appearanceApplied.delete(target); this.refreshAppearance(); }
            catch (error) { Object.assign(this.settings, previous); restore(); throw error; }
        }, restore).open();
    }
    async onload(): Promise<void> {
        const saved: Record<string, unknown> = await this.loadData() ?? {};
        this.settings = {
            organic: normalizeOrganicSettings(saved.organic),
            appearance: saved.appearance === undefined ? 'ink' : normalizeAppearancePreset(saved.appearance),
            branchColour: normalizeBranchColourMode(saved.branchColour),
            surfaceMaterial: saved.surfaceMaterial === undefined ? 'paper' : normalizeSurfaceMaterial(saved.surfaceMaterial),
            typography: normalizeMindmapTypeface(saved.typography),
            backgroundImage: typeof saved.backgroundImage === 'string' ? saved.backgroundImage : '',
            backgroundImageStrength: typeof saved.backgroundImageStrength === 'number' && Number.isFinite(saved.backgroundImageStrength)
                ? Math.max(0, Math.min(100, Math.round(saved.backgroundImageStrength))) : 35,
            mindmapLevels: normalizeMindmapLevels(saved.mindmapLevels),
            lastMode: saved.lastMode === 'body' ? 'body' : 'title',
            focusMode: saved.focusMode === 'dim' ? 'dim' : 'hide',
            compactFocus: saved.compactFocus !== false,
            language: saved.language === 'en' || saved.language === 'zh-CN' ? saved.language : 'auto',
            lastLayout: typeof saved.lastLayout === 'string' && Object.prototype.hasOwnProperty.call(LAYOUT_LABEL_KEYS, saved.lastLayout)
                ? saved.lastLayout as MindmapLayout : 'horizontal',
        };
        this.dataStore = new PluginDataStore(() => ({ ...saved, ...this.settings, organicState: this.organicStates.data, composerDrafts: this.composerDrafts.persisted, composerPreferences: this.composerDrafts.preferences }), data => this.saveData(data));
        this.composerDrafts = new ComposerStore(saved.composerDrafts, () => this.dataStore.save(), saved.composerPreferences,
            () => new Notice(ct('Draft could not be saved. Use ⋯ → Copy recovery data before closing.')),
            () => this.app.workspace.containerEl?.ownerDocument?.defaultView ?? window);
        this.organicStates = new OrganicStateStore(saved.organicState, () => this.dataStore.save(), () => this.settings.organic.rememberState,
            error => { console.error('Organic state save failed', error); new Notice(t('Organic 状态保存失败，请查看控制台。')); },
            () => this.app.workspace.containerEl?.ownerDocument?.defaultView ?? window);
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.organicStates.rename(oldPath, file.path);
            this.composerDrafts.renameCreatedPath(oldPath, file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(COMPOSER_VIEW))
                (leaf.view as ComposerView).sourceRenamed(oldPath, file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(ORGANIC_VIEW))
                (leaf.view as OrganicMindMapView).sourceRenamed(oldPath, file.path);
        }));
        this.registerEvent(this.app.vault.on('delete', file => {
            this.organicStates.remove(file.path);
            this.composerDrafts.detachCreatedPath(file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(COMPOSER_VIEW))
                (leaf.view as ComposerView).sourceDeleted(file.path);
            for (const leaf of this.app.workspace.getLeavesOfType(ORGANIC_VIEW))
                (leaf.view as OrganicMindMapView).sourceDeleted(file.path);
        }));
        this.register(() => { void this.organicStates.flush().catch(console.error); });
        setLanguage(this.settings.language, moment.locale());
        const documentHost = new ObsidianDocumentHost(this.app);
        this.register(() => documentHost.dispose());
        this.registerEditorExtension(documentHost.extension);
        this.registerView(ORGANIC_VIEW, leaf => new OrganicMindMapView(leaf, this.organicStates, () => this.settings.organic, documentHost, () => this.settings.appearance, el => this.applyAppearance(el), () => this.settings.branchColour, target => this.openAppearance(target)));
        this.registerView(COMPOSER_VIEW, leaf => new ComposerView(leaf, this.composerDrafts, () => this.settings.appearance, el => this.applyAppearance(el), () => this.settings.branchColour, target => this.openAppearance(target)));
        const openComposer = async (draftId?: string, targetFolder?: string) => {
            const existing = draftId && this.app.workspace.getLeavesOfType(COMPOSER_VIEW).find(leaf => leaf.view.getState().draftId === draftId);
            if (existing) { await this.app.workspace.revealLeaf(existing); return; }
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: COMPOSER_VIEW, active: true, state: { draftId, targetFolder } });
            (leaf.view as ComposerView).focusMap();
        };
        this.addRibbonIcon('file-plus-2', ct('New Mind Map Document'), () => { void openComposer(); });
        this.addCommand({ id: 'new-mind-map-document', name: ct('New Mind Map Document'), callback: () => { void openComposer(); } });
        this.addCommand({ id: 'restore-composer-draft', name: ct('Restore Composer Draft'), callback: () => showDrafts(this.app, this.composerDrafts, id => openComposer(id)) });
        this.addCommand({ id: 'composer-from-template', name: ct('New Composer from template'), callback: () => showTemplates(this.app, draft => {
            this.composerDrafts.put({ ...draft, ...this.composerDrafts.preferences });
            void this.composerDrafts.flush().then(() => openComposer(draft.draftId)).catch(error => new Notice(String(error)));
        }) });
        this.addCommand({ id: 'search-composer', name: ct('Composer: Search'), checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(ComposerView); if (!view) return false;
            if (!checking) view.openSearch(); return true;
        } });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (file instanceof TFolder) menu.addItem(item => item.setTitle(ct('New Mind Map Document here')).setIcon('file-plus-2').onClick(() => openComposer(undefined, file.path)));
        }));
        this.register(() => { void this.composerDrafts.flush().catch(console.error); });
        this.addCommand({ id: 'toggle-mind-map-writing', name: 'Organic: Toggle mind map writing', checkCallback: checking => {
            const view = this.app.workspace.getActiveViewOfType(OrganicMindMapView);
            if (!view) return false; if (!checking) void view.toggleWriting(); return true;
        } });
        for (const command of ['rename', 'sibling', 'child', 'promote', 'demote', 'delete', 'undo', 'redo', 'editor'] as const) {
            this.addCommand({ id: `mind-map-writing-${command}`, name: `Mind map writing: ${command}`, checkCallback: checking => {
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
                if (!file || !supportedSource(file)) return false;
                if (!checking) void this.openOrganic(file);
                return true;
            },
        });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (file instanceof TFile && supportedSource(file)) menu.addItem(item => item
                .setTitle(t('以 Organic 模式打开笔记')).setIcon('git-fork').onClick(() => this.openOrganic(file)));
        }));
        this.enhancedInterop = new EnhancedCanvasInterop(this.app);
        this.enhancedInterop.refresh();
        this.register(() => this.enhancedInterop?.close());
        this.mindmap = new CanvasMindmap(this);
        this.mindmap.register();
        this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu) => this.mindmap.addSelectionMenu(menu)));
        this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu) => this.mindmap.addSelectionMenu(menu)));
        this.registerEvent(this.app.workspace.on('canvas:node-menu', (menu, node) => {
            this.refreshEnhancedCompatibility(); this.mindmap.addMenu(menu, node);
        }));
        this.addSettingTab(new MindmapSettingTab(this));
    }

    registerLazyPatcher(patch: () => boolean): void {
        this.patchState.total++;
        watchCanvasIntegration(this, patch, () => { this.patchState.landed++; }, error => {
            console.error('Canvas Mind Map: Canvas integration failed', error);
            new Notice(t('Canvas 导图集成未能挂载，部分命令可能不可用。请确认 Obsidian 版本并查看控制台。'), 10000);
        });
    }

    async saveSettings(): Promise<void> { await this.dataStore.save(); }

    applyAppearance(element: HTMLElement): void {
        const { appearance, surfaceMaterial, typography, backgroundImage, backgroundImageStrength } = this.settings;
        const key = JSON.stringify([appearance, surfaceMaterial, typography, backgroundImage, backgroundImageStrength]);
        if (this.appearanceApplied.get(element) === key) return;
        element.dataset.cmmAppearance = appearance;
        element.dataset.cmmMaterial = surfaceMaterial;
        element.dataset.cmmTypeface = typography;
        const url = this.resourceUrl(backgroundImage);
        // A user-supplied backdrop replaces the material rather than layering under it: a dot grid
        // over a photograph is never something a reader wants, and the setting is exclusive by
        // construction rather than by a rule the user has to discover.
        if (url) {
            element.dataset.cmmBackground = 'image';
            element.style.setProperty('--cmm-background-image', `url("${url}")`);
            element.style.setProperty('--cmm-background-strength', String(backgroundImageStrength / 100));
        } else {
            delete element.dataset.cmmBackground;
            element.style.removeProperty('--cmm-background-image');
            element.style.removeProperty('--cmm-background-strength');
        }
        this.appearanceApplied.set(element, key);
    }

    /** Resolve a vault-relative path to a resource URL; an unreadable path means "no image". */
    private resourceUrl(path: string): string {
        const trimmed = path.trim();
        if (!trimmed) return '';
        if (!(this.app.vault.getAbstractFileByPath(trimmed) instanceof TFile)) return '';
        try { return this.app.vault.adapter.getResourcePath(trimmed); } catch { return ''; }
    }

    clearAppearance(element: HTMLElement): void {
        delete element.dataset.cmmAppearance;
        delete element.dataset.cmmMaterial;
        delete element.dataset.cmmTypeface;
        delete element.dataset.cmmBackground;
        element.style.removeProperty('--cmm-background-image');
        element.style.removeProperty('--cmm-background-strength');
        this.appearanceApplied.delete(element);
    }

    refreshAppearance(): void {
        for (const type of [ORGANIC_VIEW, COMPOSER_VIEW])
            for (const leaf of this.app.workspace.getLeavesOfType(type))
                if (leaf.view instanceof OrganicMindMapView || leaf.view instanceof ComposerView)
                    this.applyAppearance(leaf.view.contentEl);
        this.mindmap?.refreshAppearance();
    }

    private async openOrganic(file: TFile): Promise<void> {
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: ORGANIC_VIEW, active: true, state: { file: file.path } });
    }

    refreshLanguage(): void {
        setLanguage(this.settings.language, moment.locale());
        this.mindmap.refreshLanguage();
        for (const leaf of this.app.workspace.getLeavesOfType(COMPOSER_VIEW)) {
            if (leaf.view instanceof ComposerView) void leaf.view.refreshLanguage();
        }
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
