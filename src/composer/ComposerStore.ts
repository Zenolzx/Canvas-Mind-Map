import { clone, ComposerDraft, newDraft, normalizeDraft } from './ComposerModel';
import { windowTimers } from '../design/timers';

/** Shares the plugin's ordered writer with Organic and settings. Failed drafts stay in memory. */
export class ComposerStore {
    readonly data: Record<string, ComposerDraft> = Object.create(null);
    private unsupported: Record<string, unknown> = Object.create(null);
    preferences: { layout: ComposerDraft['layout']; panelWidth: number } = { layout: 'organic-horizontal', panelWidth: .35 };
    get persisted(): Record<string, unknown> { return { ...this.unsupported, ...this.data }; }
    private timer?: ReturnType<typeof setTimeout>;
    private revision = 0;
    private listeners = new Set<(status: string) => void>();
    /** Nothing has been written yet, so the store must not claim a save. */
    status = 'Draft not saved yet';
    private failures = 0;
    /** Resolved lazily so the debounce follows the window the document lives in. */
    private timers: ReturnType<typeof windowTimers>;
    constructor(saved: unknown, private save: () => Promise<void>, preferences?: unknown,
        private onFailure?: (error: unknown) => void, private host?: () => Window | undefined) {
        this.timers = windowTimers(() => this.host?.());
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
    renameCreatedPath(oldPath: string, newPath: string): void {
        for (const draft of Object.values(this.data)) if (draft.createdPath === oldPath) {
            draft.createdPath = newPath; this.put(draft);
        }
    }
    detachCreatedPath(path: string): void {
        for (const draft of Object.values(this.data)) if (draft.createdPath === path) {
            delete draft.createdPath; this.put(draft);
        }
    }
    subscribe(listener: (status: string) => void): () => void { this.listeners.add(listener); listener(this.status); return () => this.listeners.delete(listener); }
    private report(status: string): void { this.status = status; this.listeners.forEach(listener => listener(status)); }
    put(draft: ComposerDraft): void {
        this.preferences = { layout: draft.layout, panelWidth: draft.panelWidth };
        this.data[draft.draftId] = clone(draft); this.revision++; this.report('Saving draft…');
        this.timers.clear(this.timer);
        this.timer = this.timers.set(() => { void this.flush().catch(() => { /* reported once via onFailure */ }); }, 500);
    }
    async flush(): Promise<void> {
        this.timers.clear(this.timer); this.timer = undefined; const revision = this.revision;
        try {
            await this.save();
            if (revision === this.revision) { this.failures = 0; this.report('Draft saved'); }
        } catch (error) {
            // A debounced autosave has no caller to rethrow to, so a failure is reported once
            // through the callback rather than being swallowed.
            this.failures++;
            this.report('Draft not saved — retry or copy recovery data');
            if (this.failures === 1) this.onFailure?.(error);
            throw error;
        }
    }
    async remove(id: string): Promise<void> {
        const draft = this.data[id]; delete this.data[id];
        try { await this.flush(); } catch (error) { if (draft) this.data[id] = draft; throw error; }
    }
}
