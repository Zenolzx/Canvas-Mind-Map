import { App, Menu, Notice } from 'obsidian';
import { DOCUMENT_INTRODUCTION, DOCUMENT_ROOT, DocumentChangeCoordinator, DocumentCommitAdapter,
    DocumentStructure, DocumentStructureParser, StructureOperation, StructureViewSnapshot, subtreeSections } from '../document';
import { SectionEditorController } from './SectionEditorController';
import { chooseDeletion, showDraftRecovery, confirmDiscardDraft } from './WritingDialogs';

export interface WritingHooks {
    publish(document: DocumentStructure, selected: string, structureChanged: boolean): void;
    snapshot(): StructureViewSnapshot;
    restore(snapshot: StructureViewSnapshot): void;
    focus(id: string): void;
    reading(): void;
    changed(): void;
    reveal(id: string): void;
}
export function countWritingWords(text: string): number {
    return (text.match(/[\u3400-\u9fff]|[\p{L}\p{N}]+/gu) ?? []).length;
}

/** UI intentions only; all source mutations go through the document coordinator. */
export class MindMapWritingController {
    readonly coordinator: DocumentChangeCoordinator;
    readonly editor: SectionEditorController;
    selected = DOCUMENT_ROOT;
    private busy = false;
    private input?: HTMLInputElement;
    private draft?: { kind: 'rename' | 'sibling' | 'child'; id: string };
    private drag?: { id: string; pointer: number; x: number; y: number; active: boolean; operation?: StructureOperation };
    private abort = new AbortController();
    private preview: HTMLElement;
    private dropZones: HTMLElement;
    private validatedDrop?: { key: string; error?: string };
    private closed = false;
    active = true;
    get interacting(): boolean { return this.busy || !!this.input; }
    constructor(private app: App, adapter: DocumentCommitAdapter, text: string, path: string,
        private surface: SVGSVGElement, private overlay: HTMLElement, editorParent: HTMLElement, private hooks: WritingHooks) {
        this.coordinator = new DocumentChangeCoordinator(new DocumentStructureParser().parse(text, { sourcePath: path }), adapter);
        this.editor = new SectionEditorController(editorParent, (raw, cursor) => this.saveBody(raw, cursor), () => { void this.history('undo'); },
            link => { void this.app.workspace.openLinkText(link, this.document.sourcePath, false); }, () => this.surface.focus());
        this.preview = overlay.createDiv({ cls: 'cmm-writing-drop-preview' }); this.preview.hidden = true;
        this.dropZones = overlay.createDiv({ cls: 'cmm-writing-drop-zones' }); this.dropZones.hidden = true;
        for (const label of ['Before', 'Make child', 'After']) this.dropZones.createDiv({ text: label });
        const options = { signal: this.abort.signal, capture: true };
        surface.addEventListener('keydown', event => this.key(event), options);
        surface.addEventListener('dblclick', event => {
            if (!this.active) return;
            const id = this.node(event.target); if (!id) return;
            event.preventDefault(); event.stopPropagation(); void this.inline('rename', id);
        }, options);
        surface.addEventListener('pointerdown', event => {
            if (!this.active) return;
            const id = this.node(event.target);
            if (!id || id === DOCUMENT_ROOT || event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
            if (this.editor.dirty || this.busy || this.input) return;
            this.drag = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false };
            event.stopPropagation();
        }, options);
        surface.addEventListener('pointermove', event => this.dragMove(event), options);
        surface.addEventListener('pointerup', event => {
            const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
            if (drag.active) {
                event.preventDefault(); event.stopPropagation();
                if (drag.operation) void this.execute(drag.operation);
            }
            this.cancelDrag();
        }, options);
        surface.addEventListener('pointercancel', () => this.cancelDrag(), options);
        surface.addEventListener('click', event => {
            if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); this.suppressClick = false; }
        }, options);
        this.bindEditor();
    }
    private suppressClick = false;
    get document(): DocumentStructure { return this.coordinator.document; }
    private node(target: EventTarget | null): string | undefined {
        return (target as Element | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? undefined;
    }
    private report(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error), 7000); }
    private emit(structure = true): void { if (!this.closed) this.hooks.publish(this.document, this.selected, structure); }
    private bindEditor(offset = 0): void {
        const section = this.document.sections.get(this.selected);
        const range = section?.body ?? this.document.introduction;
        this.editor.load(section ? `${'#'.repeat(section.headingLevel)} ${section.headingText}` : 'Document introduction',
            this.document.text.slice(range.start, range.end), this.document.defaultEol, offset);
    }
    async select(id: string): Promise<void> {
        if (this.busy || this.input || !await this.editor.flush()) return;
        if (this.busy || this.input) return;
        if (id !== DOCUMENT_ROOT && !this.document.sections.has(id)) return;
        if (id !== this.selected) { this.selected = id; this.bindEditor(); }
        this.emit(false); this.hooks.reveal(id); this.hooks.changed(); this.surface.focus();
    }
    async execute(operation: StructureOperation): Promise<boolean> {
        if (this.busy || !await this.editor.flush()) return false;
        if (this.busy) return false;
        this.busy = true;
        try {
            const transaction = this.coordinator.prepare(operation);
            const before = this.hooks.snapshot();
            const next = transaction.selection.nodeId ?? DOCUMENT_ROOT;
            await this.coordinator.commit(transaction, before, { ...before, selectedNode: next });
            this.selected = next; this.emit(transaction.changeKind === 'structure'); this.bindEditor(transaction.selection.bodyOffset);
            this.hooks.reveal(next);
            this.hooks.changed(); return true;
        } catch (error) { this.report(error); return false; }
        finally { this.busy = false; }
    }
    private async saveBody(markdown: string, cursorOffset: number): Promise<void> {
        if (this.busy) throw new Error('另一个操作仍在进行，请稍后重试。');
        this.busy = true;
        try {
            const nodeId = this.selected === DOCUMENT_ROOT ? DOCUMENT_INTRODUCTION : this.selected;
            const transaction = this.coordinator.prepare({ type: 'updateBody', nodeId, markdown, cursorOffset });
            const before = this.hooks.snapshot();
            const next = transaction.selection.nodeId === DOCUMENT_INTRODUCTION ? DOCUMENT_ROOT : transaction.selection.nodeId ?? this.selected;
            await this.coordinator.commit(transaction, before, { ...before, selectedNode: next });
            this.selected = next;
            // Rebind only when the owned direct-body range changed, after saving finishes.
            // Input is read-only for this short commit, so no newer draft can be discarded.
            if (transaction.changeKind === 'structure') this.bindEditor(transaction.selection.bodyOffset);
            this.emit(transaction.changeKind === 'structure'); this.hooks.changed();
        } finally { this.busy = false; }
    }
    async history(direction: 'undo' | 'redo'): Promise<void> {
        if (this.busy || !await this.editor.flush()) return;
        if (this.busy) return;
        this.busy = true;
        try {
            const result = await this.coordinator[direction]();
            this.selected = result.view?.selectedNode ?? DOCUMENT_ROOT;
            if (this.selected !== DOCUMENT_ROOT && !this.document.sections.has(this.selected)) this.selected = DOCUMENT_ROOT;
            this.emit(); if (result.view) this.hooks.restore(result.view); this.bindEditor(); this.hooks.changed();
        } catch (error) { this.report(error); } finally { this.busy = false; }
    }
    async externalChange(): Promise<void> {
        if (this.closed) return;
        try {
            if (await this.coordinator.observeSource() !== 'external') return;
            if (this.editor.dirty || this.input) { this.report(new Error('原笔记已在外部修改。草稿已保留，请复制草稿后刷新，或取消当前操作。')); return; }
            await this.refresh();
        } catch (error) { this.report(error); }
    }
    async sourceRenamed(path: string): Promise<void> {
        try { await this.coordinator.relocate(path); this.emit(true); this.hooks.changed(); }
        catch (error) { this.report(error); }
    }
    async refresh(): Promise<boolean> {
        if (this.editor.dirty && !this.busy && !this.input) {
            const draft = this.editor.raw;
            if (!await confirmDiscardDraft(this.app, draft)) return false;
            if (this.editor.raw !== draft) { this.report(new Error('确认期间正文又有变化，已取消刷新。')); return false; }
            this.bindEditor();
        }
        if (this.busy || this.editor.dirty || this.input) {
            this.report(new Error('请先完成当前输入。未保存正文可以通过编辑器菜单复制；刷新不会覆盖草稿。')); return false;
        }
        try {
            const old = this.document.sections.get(this.selected);
            await this.coordinator.refresh();
            const candidates = [...this.document.sections.values()].filter(s => s.headingText === old?.headingText && s.headingLevel === old?.headingLevel);
            this.selected = candidates.length === 1 ? candidates[0].id : DOCUMENT_ROOT;
            this.emit(); this.bindEditor(); return true;
        } catch (error) { this.report(error); return false; }
    }
    async inline(kind: 'rename' | 'sibling' | 'child', id = this.selected): Promise<void> {
        if (this.busy || this.input || !await this.editor.flush()) return;
        if (this.busy || this.input) return;
        if (id === DOCUMENT_ROOT && kind === 'rename') return;
        if (id === DOCUMENT_ROOT) kind = 'child';
        const group = Array.from(this.surface.querySelectorAll<SVGGElement>('[data-node-id]')).find(el => el.getAttribute('data-node-id') === id);
        const rect = group?.getBoundingClientRect(), parent = this.overlay.getBoundingClientRect();
        this.draft = { kind, id };
        const input = this.overlay.createEl('input', { cls: 'cmm-writing-inline', attr: { 'aria-label': kind === 'rename' ? 'Rename heading' : 'New heading' } });
        this.input = input;
        input.value = kind === 'rename' ? this.document.sections.get(id)?.headingText ?? '' : '';
        input.placeholder = '输入标题';
        input.style.left = `${Math.max(8, Math.min((rect?.left ?? parent.left + 20) - parent.left, parent.width - 250))}px`;
        input.style.top = `${Math.max(8, (rect?.top ?? parent.top + 30) - parent.top + (kind === 'rename' ? 0 : 36))}px`;
        input.onkeydown = event => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') { event.preventDefault(); this.cancelInline(); }
            if (event.key !== 'Enter' && event.key !== 'Tab') return;
            event.preventDefault();
            if (!input.value.trim()) { this.cancelInline(); return; }
            const draft = this.draft!;
            const operation: StructureOperation = draft.kind === 'rename' ? { type: 'rename', nodeId: draft.id, title: input.value } :
                { type: draft.kind === 'child' ? 'insertChild' : 'insertSibling', nodeId: draft.id, title: input.value };
            input.disabled = true;
            void this.execute(operation).then(ok => {
                if (!ok) { input.disabled = false; input.focus(); return; }
                this.cancelInline();
                if (draft.kind !== 'rename') void this.inline(event.key === 'Tab' ? 'child' : 'sibling');
            });
        };
        input.focus(); input.select();
    }
    private cancelInline(): void { this.input?.remove(); this.input = undefined; this.draft = undefined; this.surface.focus(); }
    async remove(id = this.selected): Promise<void> {
        if (id === DOCUMENT_ROOT || this.busy || !await this.editor.flush()) return;
        const section = this.document.sections.get(id); if (!section) return;
        const revision = this.document.revision;
        const strategy = await chooseDeletion(this.app, section.headingText,
            countWritingWords(this.document.text.slice(section.body.start, section.subtree.end)), subtreeSections(this.document, id).length - 1);
        if (strategy && revision === this.document.revision) await this.execute({ type: 'delete', nodeId: id, strategy });
    }
    menu(id: string, event: MouseEvent): void {
        const menu = new Menu();
        const item = (title: string, action: () => unknown) => menu.addItem(entry => entry.setTitle(title).onClick(() => { void action(); }));
        item('编辑直属正文', async () => { await this.select(id); this.editor.focus(); });
        if (id !== DOCUMENT_ROOT) item('重命名', () => this.inline('rename', id));
        item('添加子章节', () => this.inline('child', id));
        if (id !== DOCUMENT_ROOT) {
            item('添加同级章节', () => this.inline('sibling', id)); menu.addSeparator();
            item('提升章节', () => this.execute({ type: 'promote', nodeId: id }));
            item('降为前一章节的子章节', () => this.execute({ type: 'demote', nodeId: id }));
        }
        menu.addSeparator(); item('聚焦此分支', () => this.hooks.focus(id)); item('阅读模式', () => this.hooks.reading());
        if (id !== DOCUMENT_ROOT) { menu.addSeparator(); item('删除章节…', () => this.remove(id)); }
        menu.showAtMouseEvent(event);
    }
    private key(event: KeyboardEvent): void {
        if (!this.active) return;
        if ((event.target as Element | null)?.closest('[role="button"]') && (event.key === 'Enter' || event.key === ' ')) return;
        if (event.isComposing || event.keyCode === 229) return;
        const mod = event.ctrlKey || event.metaKey, id = this.selected;
        let action: (() => unknown) | undefined;
        if (mod && event.key.toLowerCase() === 'z') action = () => this.history(event.shiftKey ? 'redo' : 'undo');
        else if (mod && event.key === 'Enter') action = () => this.editor.focus();
        else if (event.key === 'Escape') action = () => { this.cancelInline(); this.cancelDrag(); };
        else if (!mod && !event.altKey && event.key === 'F2') action = () => this.inline('rename');
        else if (!mod && !event.altKey && event.key === 'Enter') action = () => this.inline('sibling');
        else if (!mod && !event.altKey && event.key === 'Tab') action = () => event.shiftKey ? this.execute({ type: 'promote', nodeId: id }) : this.inline('child');
        else if (!mod && event.key === 'Delete') action = () => this.remove();
        else if (!mod && event.key.startsWith('Arrow')) {
            const section = this.document.sections.get(id);
            const parent = section?.parentId ?? DOCUMENT_ROOT;
            const siblings = parent === DOCUMENT_ROOT ? this.document.roots : this.document.sections.get(parent)!.children;
            const position = siblings.indexOf(id);
            if (event.altKey) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') action = () => this.execute({ type: event.key === 'ArrowLeft' ? 'promote' : 'demote', nodeId: id });
                else {
                    const target = siblings[position + (event.key === 'ArrowUp' ? -1 : 1)];
                    if (target) action = () => this.execute({ type: event.key === 'ArrowUp' ? 'moveBefore' : 'moveAfter', nodeId: id, targetId: target });
                }
            } else {
                const target = event.key === 'ArrowLeft' ? parent : event.key === 'ArrowRight' ?
                    (section?.children ?? this.document.roots)[0] : siblings[position + (event.key === 'ArrowUp' ? -1 : 1)];
                action = () => target && this.select(target);
            }
        }
        if (action) { event.preventDefault(); event.stopPropagation(); void action(); }
    }
    private dragMove(event: PointerEvent): void {
        if (!this.active) return;
        const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        drag.active = true; this.suppressClick = true;
        this.surface.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
        const target = this.surface.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]');
        const id = target?.getAttribute('data-node-id');
        drag.operation = undefined; this.preview.hidden = false;
        this.preview.style.left = `${event.clientX - this.overlay.getBoundingClientRect().left + 12}px`;
        this.preview.style.top = `${event.clientY - this.overlay.getBoundingClientRect().top + 12}px`;
        this.surface.querySelectorAll('.cmm-writing-drop-target').forEach(el => el.classList.remove('cmm-writing-drop-target'));
        if (!target || !id) { this.dropZones.hidden = true; this.preview.textContent = '移到目标章节：上方 / 子章节 / 下方'; return; }
        const rect = target.getBoundingClientRect(), ratio = (event.clientY - rect.top) / rect.height;
        const zone = id === DOCUMENT_ROOT ? 'child' : ratio < .28 ? 'before' : ratio > .72 ? 'after' : 'child';
        const operation: StructureOperation = zone === 'child' ? { type: 'move', nodeId: drag.id, parentId: id,
            index: (id === DOCUMENT_ROOT ? this.document.roots : this.document.sections.get(id)!.children).filter(child => child !== drag.id).length } :
            { type: zone === 'before' ? 'moveBefore' : 'moveAfter', nodeId: drag.id, targetId: id };
        const parent = this.overlay.getBoundingClientRect();
        this.dropZones.hidden = false; this.dropZones.style.left = `${rect.left - parent.left}px`;
        this.dropZones.style.top = `${rect.top - parent.top}px`; this.dropZones.style.width = `${rect.width}px`;
        this.dropZones.style.height = `${rect.height}px`;
        Array.from(this.dropZones.children).forEach((child, index) => child.classList.toggle('is-target', index === (zone === 'before' ? 0 : zone === 'child' ? 1 : 2)));
        const key = JSON.stringify([this.document.revision, operation]);
        if (this.validatedDrop?.key !== key) {
            try { this.coordinator.prepare(operation); this.validatedDrop = { key }; }
            catch (error) { this.validatedDrop = { key, error: error instanceof Error ? error.message : String(error) }; }
        }
        if (!this.validatedDrop.error) {
            drag.operation = operation;
            this.preview.textContent = `${zone === 'child' ? '作为子章节' : zone === 'before' ? '插入之前' : '插入之后'}：${this.document.sections.get(id)?.headingText ?? 'Document'}`;
            target.classList.add('cmm-writing-drop-target');
        } else this.preview.textContent = `不可放置：${this.validatedDrop.error}`;
    }
    private cancelDrag(): void {
        if (this.drag && this.surface.hasPointerCapture(this.drag.pointer)) this.surface.releasePointerCapture(this.drag.pointer);
        this.drag = undefined; this.preview.hidden = true; this.dropZones.hidden = true; this.validatedDrop = undefined;
        this.surface.querySelectorAll('.cmm-writing-drop-target').forEach(el => el.classList.remove('cmm-writing-drop-target'));
    }
    async close(): Promise<void> {
        const saved = await this.editor.flush();
        if (!saved && this.editor.dirty) showDraftRecovery(this.app, this.document.sourcePath, this.editor.raw);
        this.closed = true; this.abort.abort(); this.cancelInline(); this.cancelDrag(); this.preview.remove(); this.dropZones.remove(); this.editor.destroy();
    }
}
