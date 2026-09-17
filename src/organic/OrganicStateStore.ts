import type { SavedOrganicState } from './OrganicViewState';
import { normalizeWritingSnapshot } from '../writing/WritingViewSnapshot';

export interface OrganicStoredData { version: 1; files: Record<string, SavedOrganicState> }
export class OrganicStateStore {
    readonly data: OrganicStoredData = { version: 1, files: Object.create(null) };
    private timer?: ReturnType<typeof setTimeout>;
    private owners = new Map<string, object>();
    constructor(saved: unknown, private save: () => Promise<void>, private enabled: () => boolean,
        private onError: (error: unknown) => void = console.error) {
        if (!saved || typeof saved !== 'object') return;
        const input = saved as Partial<OrganicStoredData>;
        if (input.version !== 1 || !input.files || typeof input.files !== 'object') return;
        for (const [path, value] of Object.entries(input.files)) {
            const state = normalize(value);
            if (state) this.data.files[path] = state;
        }
    }
    get(path: string): SavedOrganicState | undefined {
        const value = this.enabled() ? this.data.files[path] : undefined;
        return value ? JSON.parse(JSON.stringify(value)) : undefined;
    }
    /** Called on actual user actions, never on closing an idle tab. */
    put(path: string, state: SavedOrganicState, owner?: object): void {
        if (!this.enabled()) return;
        if (owner) this.owners.set(path, owner);
        // View snapshots own their arrays; document descriptors are immutable between refreshes.
        this.data.files[path] = state;
        this.schedule();
    }
    sync(path: string, state: SavedOrganicState, owner: object): void {
        if (this.owners.get(path) === owner) this.put(path, state, owner);
    }
    rename(oldPath: string, path: string): void {
        for (const key of Object.keys(this.data.files)) if (key === oldPath || key.startsWith(oldPath + '/')) {
            const target = path + key.slice(oldPath.length);
            this.data.files[target] = this.data.files[key]; delete this.data.files[key];
            const owner = this.owners.get(key); if (owner) this.owners.set(target, owner); this.owners.delete(key);
            this.schedule();
        }
    }
    remove(path: string): void {
        for (const key of Object.keys(this.data.files)) if (key === path || key.startsWith(path + '/')) {
            delete this.data.files[key]; this.owners.delete(key); this.schedule();
        }
    }
    reset(): Promise<void> { this.data.files = Object.create(null); this.owners.clear(); return this.flush(true); }
    private schedule(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 750);
    }
    async flush(force = false): Promise<void> {
        if (this.timer === undefined && !force) return;
        clearTimeout(this.timer); this.timer = undefined; await this.save();
    }
}

function normalize(value: unknown): SavedOrganicState | undefined {
    if (!value || typeof value !== 'object') return;
    const s = value as SavedOrganicState, v = s.viewport;
    if (typeof s.fingerprint !== 'string' || !Array.isArray(s.collapsed) || !v ||
        !Number.isFinite(v.zoom) || v.zoom < 0.05 || v.zoom > 4 || !v.center ||
        !Number.isFinite(v.center.x) || !Number.isFinite(v.center.y)) return;
    const id = (value: unknown) => typeof value === 'string' ? value : null;
    const identities = Array.isArray(s.identities) ? s.identities.filter(n => n && typeof n.id === 'string' &&
        typeof n.key === 'string' && typeof n.title === 'string' && typeof n.body === 'string' &&
        Number.isFinite(n.level) && Number.isFinite(n.line)) : undefined;
    const branchStyles: Record<string, { color: string; side: number }> = Object.create(null);
    const snapshot = normalizeWritingSnapshot(s.writing?.snapshot);
    const writing = snapshot ? { enabled: s.writing?.enabled === true, editorVisible: s.writing?.editorVisible !== false,
        splitRatio: Number.isFinite(s.writing?.splitRatio) ? Math.max(.25, Math.min(.8, s.writing!.splitRatio)) : .6, snapshot } : undefined;
    if (s.branchStyles && typeof s.branchStyles === 'object') for (const [id, style] of Object.entries(s.branchStyles)) {
        if (style && /^#[\da-f]{6}$/i.test(style.color) && (style.side === 0 || style.side === 1)) branchStyles[id] = style;
    }
    return { fingerprint: s.fingerprint, identities, branchStyles, writing, collapsed: s.collapsed.filter(x => typeof x === 'string'),
        viewport: { zoom: v.zoom, center: { ...v.center } }, focusNode: id(s.focusNode), selectedNode: id(s.selectedNode),
        reading: { rootNode: id(s.reading?.rootNode), currentNode: id(s.reading?.currentNode) },
        layout: s.layout === 'organic-horizontal' || s.layout === 'compact-organic' ? s.layout : 'organic-radial' };
}
