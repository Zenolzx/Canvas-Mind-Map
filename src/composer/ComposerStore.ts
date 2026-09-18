import { clone, ComposerDraft, newDraft, normalizeDraft } from './ComposerModel';

/** Shares the plugin's ordered writer with Organic and settings. Failed drafts stay in memory. */
export class ComposerStore {
    readonly data: Record<string, ComposerDraft> = Object.create(null);
    private unsupported: Record<string, unknown> = Object.create(null);
    preferences: { layout: ComposerDraft['layout']; panelWidth: number } = { layout: 'organic-horizontal', panelWidth: .35 };
    get persisted(): Record<string, unknown> { return { ...this.unsupported, ...this.data }; }
    private timer?: ReturnType<typeof setTimeout>;
    private revision = 0;
    private listeners = new Set<(status: string) => void>();
    status = 'Draft saved';
    constructor(saved: unknown, private save: () => Promise<void>, preferences?: unknown) {
        if (preferences && typeof preferences === 'object') {
            const p = preferences as typeof this.preferences;
            if (['organic-horizontal', 'organic-radial', 'compact-organic'].includes(p.layout)) this.preferences.layout = p.layout;
            if (Number.isFinite(p.panelWidth)) this.preferences.panelWidth = Math.max(.2, Math.min(.7, p.panelWidth));
        }
        if (saved && typeof saved === 'object') for (const [id, raw] of Object.entries(saved)) {
            try {
                const draft = normalizeDraft(raw);
                if (draft.draftId !== id) throw new Error('Draft identity mismatch.');
                this.data[id] = draft;
            } catch { this.unsupported[id] = clone(raw); }
        }
    }
    create(folder = ''): ComposerDraft { return { ...newDraft(folder), ...this.preferences }; }
    subscribe(listener: (status: string) => void): () => void { this.listeners.add(listener); listener(this.status); return () => this.listeners.delete(listener); }
    private report(status: string): void { this.status = status; this.listeners.forEach(listener => listener(status)); }
    put(draft: ComposerDraft): void {
        this.preferences = { layout: draft.layout, panelWidth: draft.panelWidth };
        this.data[draft.draftId] = clone(draft); this.revision++; this.report('Saving draft…');
        clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 500);
    }
    async flush(): Promise<void> {
        clearTimeout(this.timer); this.timer = undefined; const revision = this.revision;
        try { await this.save(); if (revision === this.revision) this.report('Draft saved'); }
        catch (error) { this.report('Draft not saved — retry or copy recovery data'); throw error; }
    }
    async remove(id: string): Promise<void> {
        const draft = this.data[id]; delete this.data[id];
        try { await this.flush(); } catch (error) { if (draft) this.data[id] = draft; throw error; }
    }
}
