import { App, Modal } from 'obsidian';
import { ct } from '../i18n';
import type { AppearancePreset, SurfaceMaterial } from '../settings';

export interface AppearanceChoice { appearance: AppearancePreset; surfaceMaterial: SurfaceMaterial }
export const WORKSPACE_THEMES: { id: AppearancePreset; label: string; description: string }[] = [
    { id: 'ink', label: 'Mineral paper', description: 'Warm paper, mineral teal and quiet grain.' },
    { id: 'slate', label: 'Midnight graphite', description: 'Deep slate, soft ink and amber details.' },
    { id: 'breeze', label: 'Forest mist', description: 'Sage paper and a calm botanical atmosphere.' },
    { id: 'cinnabar', label: 'Terracotta', description: 'Warm ivory with earthy red accents.' },
    { id: 'violet', label: 'Muted lavender', description: 'Soft lavender with plum accents.' },
    { id: 'obsidian', label: 'Follow Obsidian', description: 'Use your vault’s own colours.' },
];

/** Preview is local to the invoking pane; only Apply persists a choice. */
export class AppearancePicker extends Modal {
    private choice: AppearanceChoice;
    private committed = false;
    constructor(app: App, private target: HTMLElement, private initial: AppearanceChoice,
        private save: (choice: AppearanceChoice) => Promise<void>, private restore: () => void) {
        super(app); this.choice = { ...initial };
    }
    onOpen(): void {
        this.titleEl.textContent = ct('Workspace appearance');
        this.contentEl.addClass('cmm-appearance-picker');
        this.contentEl.createEl('p', { cls: 'cmm-appearance-intro', text: ct('A complete atmosphere for your ideas. Preview here, then apply to your workspace.') });
        const grid = this.contentEl.createDiv({ cls: 'cmm-theme-gallery', attr: { role: 'group', 'aria-label': ct('Workspace theme') } });
        const select = () => {
            grid.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === this.choice.appearance)));
            this.target.dataset.cmmAppearance = this.choice.appearance;
            this.target.dataset.cmmMaterial = this.choice.surfaceMaterial;
        };
        for (const theme of WORKSPACE_THEMES) {
            const button = grid.createEl('button', { cls: 'cmm-theme-option', attr: { 'aria-label': ct(theme.label) } });
            button.dataset.theme = theme.id;
            const preview = button.createDiv({ cls: 'cmm-theme-preview cmm-organic-view', attr: { 'data-cmm-appearance': theme.id, 'data-cmm-material': 'paper' } });
            preview.createDiv({ cls: 'cmm-theme-preview-branch' });
            for (const cls of ['root', 'first', 'second']) preview.createDiv({ cls: `cmm-theme-preview-node ${cls}` });
            button.createEl('strong', { text: ct(theme.label) });
            button.createSpan({ text: ct(theme.description) });
            button.onclick = () => { this.choice.appearance = theme.id; select(); };
        }
        const material = this.contentEl.createDiv({ cls: 'cmm-material-options', attr: { role: 'group', 'aria-label': ct('Surface') } });
        for (const [value, label] of [['paper', 'Paper'], ['dots', 'Dots'], ['grid', 'Grid'], ['none', 'Plain']] as const) {
            const button = material.createEl('button', { text: ct(label), attr: { 'aria-pressed': String(this.choice.surfaceMaterial === value) } });
            button.onclick = () => {
                this.choice.surfaceMaterial = value;
                material.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); select();
            };
        }
        const error = this.contentEl.createDiv({ cls: 'cmm-appearance-error', attr: { role: 'alert' } });
        const actions = this.contentEl.createDiv({ cls: 'cmm-appearance-actions' });
        actions.createEl('button', { text: ct('Cancel') }).onclick = () => this.close();
        const apply = actions.createEl('button', { cls: 'mod-cta', text: ct('Apply appearance') });
        apply.onclick = async () => {
            apply.disabled = true;
            try { await this.save(this.choice); this.committed = true; this.close(); }
            catch { error.textContent = ct('Appearance could not be saved. Please try again.'); apply.disabled = false; }
        };
        select();
    }
    onClose(): void { if (!this.committed) this.restore(); }
}
