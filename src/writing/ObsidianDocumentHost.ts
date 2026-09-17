import { App, editorInfoField, MarkdownView, Notice, TFile } from 'obsidian';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { around } from 'monkey-around';
import { CommitSource, DocumentCommitAdapter, normalizeEditorText } from '../document';

/** Short file commit lease shared by every Writing view and native editor extension. */
export class ObsidianDocumentHost implements DocumentCommitAdapter {
    private editors = new Set<EditorView>();
    private locked?: string;
    private syncing = false;
    private queue: Promise<unknown> = Promise.resolve();
    private noticeAt = 0;
    private releaseLease?: () => void;
    private leaseEnded: Promise<void> = Promise.resolve();
    private failedLeases = new WeakMap<Promise<void>, Error>();
    private saves = new Set<Promise<unknown>>();
    private intercepted = new Map<MarkdownView, () => void>();
    constructor(private app: App) {}
    readonly extension = [
        ViewPlugin.define(view => {
            this.editors.add(view);
            this.watchNativeView(view);
            return { update: () => this.watchNativeView(view), destroy: () => {
                const info = view.state.field(editorInfoField, false);
                this.editors.delete(view);
                queueMicrotask(() => {
                    if (info instanceof MarkdownView && !this.hasEditor(info) && !this.isOpen(info)) {
                        this.intercepted.get(info)?.(); this.intercepted.delete(info);
                    }
                });
            } };
        }),
        EditorState.transactionFilter.of(transaction => {
            if (!this.locked || this.syncing || !transaction.docChanged) return transaction;
            const path = transaction.startState.field(editorInfoField, false)?.file?.path;
            if (path && path !== this.locked) return transaction;
            if (Date.now() - this.noticeAt > 1500) {
                this.noticeAt = Date.now(); new Notice('正在提交脑图修改，请稍后继续输入。');
            }
            return [];
        }),
    ];
    private watchNativeView(view: EditorView): void {
        const info = view.state.field(editorInfoField, false);
        if (info instanceof MarkdownView) this.watchSave(info);
    }
    private hasEditor(info: MarkdownView): boolean {
        return [...this.editors].some(editor => editor.state.field(editorInfoField, false) === info);
    }
    private isOpen(view: MarkdownView): boolean {
        let open = false; this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view === view) open = true; }); return open;
    }
    private previews(path: string): MarkdownView[] {
        const views: MarkdownView[] = [];
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.getMode() !== 'source') views.push(leaf.view);
        });
        return views;
    }
    private watchSave(view: MarkdownView): void {
        if (this.intercepted.has(view)) return;
        const host = this;
        this.intercepted.set(view, around(view, { save: original => function (...args: Parameters<MarkdownView['save']>) {
            const run = () => {
                const result = Promise.resolve(original.apply(this, args));
                host.saves.add(result);
                void result.finally(() => host.saves.delete(result)).catch(() => {});
                return result;
            };
            if (host.locked === view.file?.path) {
                const lease = host.leaseEnded;
                return lease.then(() => {
                    const failure = host.failedLeases.get(lease); if (failure) throw failure;
                    if (!host.hasEditor(view) && (!host.isOpen(view) || view.getMode() === 'source'))
                        throw new Error('编辑页已关闭，已取消旧缓冲的延迟保存。');
                    return view.save(...args);
                });
            }
            return run();
        } }));
    }
    dispose(): void {
        void this.queue.finally(() => { for (const undo of this.intercepted.values()) undo(); this.intercepted.clear(); }).catch(() => {});
    }
    private file(path: string): TFile {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Source Markdown file no longer exists.');
        return file;
    }
    private peers(path: string): EditorView[] {
        return [...this.editors].filter(view => {
            const info = view.state.field(editorInfoField, false);
            // Obsidian retains an inactive source editor while a leaf is in reading mode.
            // Its old doc is not that leaf's live buffer; getViewData is authoritative there.
            return info?.file?.path === path && (!(info instanceof MarkdownView) || info.getMode() === 'source');
        });
    }
    private synchronized(path: string, text: string): boolean {
        const peers = this.peers(path);
        if (peers.some(view => !(view.state.field(editorInfoField, false) instanceof MarkdownView))) return false;
        let known = true;
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.getMode() === 'source') {
                if (!peers.some(view => view.state.field(editorInfoField, false)?.editor === (leaf.view as MarkdownView).editor)) known = false;
            }
        });
        // Native editors normalize line endings. Do not trigger their save pipeline for a
        // mixed/CR source: the user can close that native tab and keep editing here safely.
        if (peers.length && text.includes('\r')) return false;
        return known && peers.every(view => view.state.doc.toString() === normalizeEditorText(text)) &&
            this.previews(path).every(view => normalizeEditorText(view.getViewData()) === normalizeEditorText(text));
    }
    async read(path: string): Promise<CommitSource> {
        const text = await this.app.vault.read(this.file(path));
        return { text, editorsSynchronized: this.synchronized(path, text) };
    }
    private synchronizePeers(path: string, before: string, after: string): void {
        const desired = normalizeEditorText(after), peers = this.peers(path), previews = this.previews(path);
        if (peers.some(view => {
            const current = view.state.doc.toString();
            return current !== desired && current !== normalizeEditorText(before);
        }) || previews.some(view => {
            const current = normalizeEditorText(view.getViewData());
            return current !== desired && current !== normalizeEditorText(before);
        })) throw new Error('Another editor changed during commit. Its draft was retained; refresh required.');
        this.syncing = true;
        try {
            for (const view of peers) {
                const current = view.state.doc.toString(); if (current === desired) continue;
                let from = 0, end = current.length, newEnd = desired.length;
                while (from < end && from < newEnd && current[from] === desired[from]) from++;
                while (end > from && newEnd > from && current[end - 1] === desired[newEnd - 1]) { end--; newEnd--; }
                view.dispatch({ changes: { from, to: end, insert: desired.slice(from, newEnd) }, annotations: Transaction.addToHistory.of(false) });
            }
            for (const view of previews) if (view.getViewData() !== after) view.setViewData(after, false);
        } finally { this.syncing = false; }
    }
    process(path: string, transform: (source: CommitSource) => string): Promise<string> {
        const work = this.queue.catch(() => {}).then(async () => {
            this.locked = path;
            this.leaseEnded = new Promise(resolve => { this.releaseLease = resolve; });
            let before: string | undefined;
            try {
                this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view instanceof MarkdownView) this.watchSave(leaf.view); });
                await Promise.all([...this.saves]);
                const result = await this.app.vault.process(this.file(path), text => {
                    before = text;
                    if (text.includes('\r') && this.peers(path).length)
                        throw new Error('此笔记含 CR/CRLF 换行。为保留原始格式，请先关闭它的普通 Markdown 编辑页，再刷新脑图重试。');
                    return transform({ text, editorsSynchronized: this.synchronized(path, text) });
                });
                // Native editors opened during the async write are covered by the same extension.
                // Update only buffers proven to contain the exact pre-commit or post-commit text.
                this.synchronizePeers(path, before!, result);
                return result;
            } catch (error) {
                // A write can succeed and then reject. Read evidence; never roll the file back.
                // If evidence cannot be obtained, reject deferred saves instead of letting an
                // old native buffer overwrite a possibly successful structural write.
                try {
                    if (before === undefined) throw error;
                    this.synchronizePeers(path, before, await this.app.vault.read(this.file(path)));
                } catch {
                    this.failedLeases.set(this.leaseEnded, new Error('文件保存状态不确定，已取消延迟保存。编辑器草稿仍保留，请核对原笔记后再保存。'));
                }
                throw error;
            } finally {
                this.syncing = false; this.locked = undefined;
                this.releaseLease?.(); this.releaseLease = undefined;
            }
        });
        this.queue = work; return work;
    }
}
