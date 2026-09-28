import { App, Menu, Modal, Notice } from 'obsidian';
import { DocxEditor, DocxOperation } from '../formats/DocxEditor';
import type { MindMapModel } from '../core/MindMapModel';
import { showDraftRecovery } from './WritingDialogs';

export class DocxWritingController {
    active = true;
    selected = 'document';
    private busy = false;
    private timer?: ReturnType<typeof setTimeout>;
    private saved = '';
    private undoStack: ArrayBuffer[] = [];
    private redoStack: ArrayBuffer[] = [];
    private drag?: { id: string; pointer: number; x: number; y: number; moved: boolean; target?: string; place?: 'before' | 'after' | 'child' };
    private suppressClick = false;
    private heading: HTMLElement;
    private status: HTMLElement;
    private textarea: HTMLTextAreaElement;
    private abort = new AbortController();
    constructor(private app: App, readonly source: DocxEditor, private surface: SVGSVGElement,
        editorPane: HTMLElement, private publish: (model: MindMapModel, selected: string) => void) {
        this.heading = editorPane.createEl('h3');
        this.status = editorPane.createDiv({ cls: 'cmm-writing-editor-status' });
        this.textarea = editorPane.createEl('textarea', { cls: 'cmm-docx-body-editor', attr: { 'aria-label': 'DOCX 章节正文' } });
        this.textarea.style.width = '100%'; this.textarea.style.minHeight = '60%'; this.textarea.style.resize = 'vertical';
        this.textarea.addEventListener('input', () => {
            this.status.textContent = '尚未保存…';
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => { void this.flush(); }, 650);
        }, { signal: this.abort.signal });
        this.textarea.addEventListener('blur', () => { void this.flush(); }, { signal: this.abort.signal });
        surface.addEventListener('dblclick', event => {
            if (!this.active) return;
            const id = (event.target as Element | null)?.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (id && id !== 'document') { event.preventDefault(); event.stopPropagation(); void this.rename(id); }
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('pointerdown', event => {
            if (!this.active || event.button !== 0) return;
            const id = (event.target as Element | null)?.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (!id || id === 'document' || (event.target as Element).closest('[role="button"]')) return;
            this.drag = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('pointermove', event => {
            const drag = this.drag; if (!this.active || !drag || drag.pointer !== event.pointerId) return;
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
            drag.moved = true; event.preventDefault(); event.stopPropagation();
            const target = surface.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]');
            const id = target?.getAttribute('data-node-id');
            surface.querySelectorAll('.cmm-writing-drop-target').forEach(element => element.classList.remove('cmm-writing-drop-target'));
            drag.target = undefined;
            if (!id || id === drag.id) return;
            const rect = target!.getBoundingClientRect(), ratio = (event.clientY - rect.top) / rect.height;
            drag.target = id; drag.place = id === 'document' ? 'child' : ratio < .28 ? 'before' : ratio > .72 ? 'after' : 'child';
            target!.classList.add('cmm-writing-drop-target');
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('pointerup', event => {
            const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
            this.drag = undefined;
            surface.querySelectorAll('.cmm-writing-drop-target').forEach(element => element.classList.remove('cmm-writing-drop-target'));
            if (drag.moved) { this.suppressClick = true; event.preventDefault(); event.stopPropagation(); }
            if (drag.target && drag.place) void this.execute({ type: 'move', id: drag.id, target: drag.target, place: drag.place });
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('pointercancel', () => { this.drag = undefined;
            surface.querySelectorAll('.cmm-writing-drop-target').forEach(element => element.classList.remove('cmm-writing-drop-target'));
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('click', event => {
            if (this.suppressClick) { this.suppressClick = false; event.preventDefault(); event.stopPropagation(); }
        }, { signal: this.abort.signal, capture: true });
        surface.addEventListener('keydown', event => {
            if (!this.active || event.isComposing) return;
            if ((event.target as Element | null)?.closest('[role="button"]') && (event.key === 'Enter' || event.key === ' ')) return;
            const id = this.selected;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault(); event.stopPropagation(); void this.history(event.shiftKey ? 'redo' : 'undo');
            } else if (event.key === 'F2' && id !== 'document') { event.preventDefault(); event.stopPropagation(); void this.rename(id); }
            else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); event.stopPropagation(); void this.insert(id, id === 'document' ? 'child' : 'after');
            } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); event.stopPropagation(); void this.insert(id, 'child');
            } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault(); event.stopPropagation(); this.focusBody();
            } else if (event.key === 'Delete' && id !== 'document') { event.preventDefault(); event.stopPropagation(); void this.remove(id); }
            else if (event.altKey && id !== 'document' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                event.preventDefault(); event.stopPropagation(); void this.execute({ type: 'level', id, delta: event.key === 'ArrowLeft' ? -1 : 1 });
            }
        }, { signal: this.abort.signal, capture: true });
        this.loadBody();
    }
    get model(): MindMapModel { return this.source.model; }
    get interacting(): boolean { return this.busy; }
    focusBody(): void { this.textarea.focus(); }
    private loadBody(): void {
        const node = this.model.nodes.find(item => item.id === this.selected) ?? this.model.nodes[0];
        this.selected = node.id;
        const body = this.source.body(node.id);
        this.heading.textContent = node.title;
        this.textarea.value = body.text; this.textarea.readOnly = !body.editable;
        this.saved = body.text;
        this.status.textContent = body.editable ? '仅当前章节直属纯文本正文' : '此章节含复杂内容，正文只读';
    }
    async flush(): Promise<boolean> {
        if (this.timer) clearTimeout(this.timer); this.timer = undefined;
        if (this.busy || this.textarea.value === this.saved || this.textarea.readOnly) return !this.busy;
        this.busy = true; this.textarea.readOnly = true;
        try {
            const before = this.source.raw;
            const model = await this.source.execute({ type: 'body', id: this.selected, text: this.textarea.value });
            this.undoStack.push(before); this.redoStack = [];
            this.saved = this.textarea.value; this.publish(model, this.selected);
            this.status.textContent = '已保存'; return true;
        } catch (error) {
            this.status.textContent = `草稿已保留：${error instanceof Error ? error.message : String(error)}`;
            return false;
        } finally { this.busy = false; this.textarea.readOnly = !this.source.body(this.selected).editable; }
    }
    async select(id: string): Promise<void> {
        if (!this.model.nodes.some(node => node.id === id) || !await this.flush()) return;
        this.selected = id; this.loadBody(); this.publish(this.model, id);
    }
    async execute(operation: DocxOperation): Promise<boolean> {
        if (!await this.flush() || this.busy) return false;
        this.busy = true;
        try {
            const before = this.source.raw;
            const prior = this.model.nodes.find(node => node.id === ('id' in operation ? operation.id : ''));
            const model = await this.source.execute(operation);
            this.undoStack.push(before); this.redoStack = [];
            const desired = operation.type === 'insert' || operation.type === 'rename' ? operation.title : prior?.title;
            const selected = model.nodes.find(node => node.title === desired)?.id ?? 'document';
            this.selected = selected; this.loadBody(); this.publish(model, selected); return true;
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); return false; }
        finally { this.busy = false; }
    }
    async history(direction: 'undo' | 'redo'): Promise<void> {
        if (!await this.flush() || this.busy) return;
        const from = direction === 'undo' ? this.undoStack : this.redoStack;
        const to = direction === 'undo' ? this.redoStack : this.undoStack;
        const snapshot = from[from.length - 1]; if (!snapshot) return;
        this.busy = true;
        try {
            const current = this.source.raw;
            const model = await this.source.restore(snapshot);
            from.pop(); to.push(current);
            this.selected = model.nodes.some(node => node.id === this.selected) ? this.selected : 'document';
            this.loadBody(); this.publish(model, this.selected);
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); }
        finally { this.busy = false; }
    }
    private textDialog(title: string, initial: string, submit: (value: string) => Promise<unknown>): void {
        const modal = new Modal(this.app); modal.setTitle(title);
        const input = modal.contentEl.createEl('input', { attr: { 'aria-label': title } });
        input.value = initial; input.style.width = '100%';
        const save = async () => { if (!input.value.trim()) return; input.disabled = true; await submit(input.value.trim()); modal.close(); };
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } };
        const button = modal.contentEl.createEl('button', { text: '保存' }); button.onclick = () => { void save(); };
        modal.open(); input.focus(); input.select();
    }
    async rename(id = this.selected): Promise<void> {
        const node = this.model.nodes.find(item => item.id === id); if (!node || id === 'document') return;
        this.textDialog('重命名章节', node.title, value => this.execute({ type: 'rename', id, title: value }));
    }
    async insert(id = this.selected, place: 'before' | 'after' | 'child' = 'child'): Promise<void> {
        if (id === 'document' && place !== 'child') place = 'child';
        this.textDialog('添加章节', '', value => this.execute({ type: 'insert', id, place, title: value }));
    }
    async remove(id = this.selected): Promise<void> {
        if (id === 'document') return;
        const node = this.model.nodes.find(item => item.id === id); if (!node) return;
        const modal = new Modal(this.app); modal.setTitle(`删除「${node.title}」`);
        modal.contentEl.createEl('p', { text: '删除整节会同时删除其正文和子章节。' });
        modal.contentEl.createEl('button', { text: '删除整节' }).onclick = () => { modal.close(); void this.execute({ type: 'delete', id }); };
        modal.contentEl.createEl('button', { text: '只删除标题，提升子章节' }).onclick = () => {
            modal.close(); void this.execute({ type: 'delete', id, promoteChildren: true });
        };
        modal.open();
    }
    private move(id: string): void {
        const modal = new Modal(this.app); modal.setTitle('移动章节');
        const target = modal.contentEl.createEl('select', { attr: { 'aria-label': '目标章节' } });
        for (const node of this.model.nodes) if (node.id !== id) target.createEl('option', { text: node.title, value: node.id });
        const place = modal.contentEl.createEl('select', { attr: { 'aria-label': '放置位置' } });
        for (const value of ['before', 'after', 'child'] as const) place.createEl('option', { text: value, value });
        modal.contentEl.createEl('button', { text: '移动' }).onclick = () => {
            modal.close(); void this.execute({ type: 'move', id, target: target.value, place: place.value as 'before' | 'after' | 'child' });
        };
        modal.open();
    }
    menu(id: string, event: MouseEvent): void {
        const menu = new Menu();
        const item = (title: string, action: () => unknown) => menu.addItem(entry => entry.setTitle(title).onClick(() => { void action(); }));
        item('阅读／编辑直属正文', async () => { await this.select(id); this.focusBody(); });
        if (id !== 'document') item('重命名', () => this.rename(id));
        item('添加子章节', () => this.insert(id, 'child'));
        if (id !== 'document') {
            item('在前面添加章节', () => this.insert(id, 'before'));
            item('在后面添加章节', () => this.insert(id, 'after'));
            menu.addSeparator();
            item('提升章节', () => this.execute({ type: 'level', id, delta: -1 }));
            item('降低章节', () => this.execute({ type: 'level', id, delta: 1 }));
            item('移动章节…', () => this.move(id));
            item('删除章节…', () => this.remove(id));
        }
        menu.showAtMouseEvent(event);
    }
    async close(): Promise<boolean> {
        const saved = await this.flush();
        if (!saved) { showDraftRecovery(this.app, this.heading.textContent ?? 'DOCX', this.textarea.value); return false; }
        this.abort.abort(); this.textarea.remove(); this.heading.remove(); this.status.remove(); return true;
    }
}
