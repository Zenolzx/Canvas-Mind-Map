import { Compartment, EditorState, StateField } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { normalizeEditorText, SectionTextBuffer } from '../document';
import { sectionTextExtension } from './SectionEditorState';

export class SectionEditorController {
    private view?: EditorView;
    private field?: StateField<SectionTextBuffer>;
    private saved = '';
    private timer?: ReturnType<typeof setTimeout>;
    private readonlyAccess = new Compartment();
    private pending?: Promise<boolean>;
    private title: HTMLElement;
    private status: HTMLElement;
    private container: HTMLElement;
    constructor(parent: HTMLElement, private save: (raw: string, cursor: number) => Promise<void>,
        private fallbackUndo: () => void, private openLink?: (link: string) => void, private focusMap?: () => void) {
        this.title = parent.createEl('h3');
        this.status = parent.createDiv({ cls: 'cmm-writing-editor-status' });
        this.container = parent.createDiv({ cls: 'cmm-writing-editor-content' });
    }
    get dirty(): boolean { return this.raw !== this.saved; }
    get raw(): string { return this.view && this.field ? this.view.state.field(this.field).sourceText : ''; }
    get composing(): boolean { return this.view?.composing ?? false; }
    get cursor(): number { return this.view && this.field ? this.view.state.field(this.field).sourceOffset(this.view.state.selection.main.head) : 0; }
    load(title: string, raw: string, eol: string, offset = 0): void {
        const focused = this.view?.hasFocus;
        this.view?.destroy(); this.container.empty(); this.saved = raw;
        this.title.textContent = title; this.status.textContent = '仅当前章节直属正文';
        const rawState = sectionTextExtension(raw, eol === '\r\n' || eol === '\r' ? eol : '\n');
        this.field = rawState.field;
        const text = normalizeEditorText(raw);
        const head = normalizeEditorText(raw.slice(0, offset)).length;
        this.view = new EditorView({ parent: this.container, state: EditorState.create({ doc: text,
            selection: { anchor: Math.min(head, text.length) }, extensions: [
                rawState.extension, history(), markdown(), syntaxHighlighting(defaultHighlightStyle), lineNumbers(),
                EditorView.lineWrapping, this.readonlyAccess.of(EditorState.readOnly.of(false)),
                keymap.of([...historyKeymap, ...defaultKeymap, indentWithTab,
                    { key: 'Mod-z', run: () => { this.fallbackUndo(); return true; } },
                    { key: 'Mod-b', run: view => this.wrap(view, '**', '**') },
                    { key: 'Mod-i', run: view => this.wrap(view, '*', '*') },
                    { key: 'Mod-k', run: view => this.wrap(view, '[', '](url)') },
                    { key: 'Escape', run: () => { this.focusMap?.(); return true; } },
                ]),
                EditorView.domEventHandlers({ mousedown: (event, view) => {
                    if (!(event.ctrlKey || event.metaKey) || !this.openLink) return false;
                    const position = view.posAtCoords({ x: event.clientX, y: event.clientY }); if (position === null) return false;
                    const line = view.state.doc.lineAt(position), offset = position - line.from;
                    const pattern = /\[\[([^\]\n]+)\]\]|\[[^\]\n]*\]\(([^)\n]+)\)/g;
                    let match: RegExpExecArray | null;
                    while ((match = pattern.exec(line.text))) if (offset >= match.index && offset <= match.index + match[0].length) {
                        this.openLink((match[1]?.split('|')[0] ?? match[2]).trim()); return true;
                    }
                    return false;
                } }),
                EditorView.updateListener.of(update => {
                    if (!update.docChanged) return;
                    this.status.textContent = '尚未保存…';
                    if (this.timer) clearTimeout(this.timer);
                    this.timer = setTimeout(() => { void this.flush(); }, 650);
                }),
            ] }) });
        if (focused) this.view.focus();
    }
    private wrap(view: EditorView, left: string, right: string): boolean {
        if (view.state.readOnly) return true;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: left + view.state.sliceDoc(from, to) + right },
            selection: { anchor: from + left.length, head: to + left.length }, userEvent: 'input' });
        return true;
    }
    focus(): void { this.view?.focus(); }
    async flush(): Promise<boolean> {
        if (this.pending) return this.pending;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.dirty) return true;
        if (this.composing) {
            this.timer = setTimeout(() => { void this.flush(); }, 200); return false;
        }
        const raw = this.raw, cursor = this.cursor, editor = this.view;
        editor?.dispatch({ effects: this.readonlyAccess.reconfigure(EditorState.readOnly.of(true)) });
        this.status.textContent = '正在保存…';
        const work = (async () => {
            try {
                await this.save(raw, cursor);
                this.saved = this.raw;
                this.status.textContent = '已保存 · 仅当前章节直属正文';
                return true;
            } catch (error) {
                this.status.textContent = `草稿已保留：${error instanceof Error ? error.message : String(error)}`;
                return false;
            } finally {
                if (this.view === editor) editor?.dispatch({ effects: this.readonlyAccess.reconfigure(EditorState.readOnly.of(false)) });
                this.pending = undefined;
            }
        })();
        this.pending = work; return work;
    }
    markSaved(): void { this.saved = this.raw; }
    destroy(): void { if (this.timer) clearTimeout(this.timer); this.view?.destroy(); }
}
