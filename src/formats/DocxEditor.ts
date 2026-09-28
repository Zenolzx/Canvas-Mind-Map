import { App, TFile } from 'obsidian';
import { strToU8, zipSync } from 'fflate/browser';
import { XMLSerializer } from '@xmldom/xmldom';
import { binaryFingerprint, DocxBlock, DocxParsed, parseDocx } from './SourceFormats';
import type { MindMapModel } from '../core/MindMapModel';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export type DocxOperation =
    | { type: 'rename'; id: string; title: string }
    | { type: 'insert'; id: string; title: string; place: 'before' | 'after' | 'child' }
    | { type: 'delete'; id: string; promoteChildren?: boolean }
    | { type: 'level'; id: string; delta: -1 | 1 }
    | { type: 'move'; id: string; target: string; place: 'before' | 'after' | 'child' }
    | { type: 'body'; id: string; text: string };

function first(parent: Element, name: string): Element | undefined {
    for (let child = parent.firstChild; child; child = child.nextSibling)
        if (child.nodeType === 1 && (child as Element).localName === name) return child as Element;
    return undefined;
}
function descendants(parent: Node, name: string): Element[] {
    const items: Element[] = [];
    const visit = (node: Node) => { for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1 && (child as Element).localName === name) items.push(child as Element);
        visit(child);
    } };
    visit(parent); return items;
}
function endOf(blocks: DocxBlock[], start: number, level: number): number {
    let end = start + 1;
    while (end < blocks.length && (!blocks[end].headingLevel || blocks[end].headingLevel > level)) end++;
    return end;
}
function blockFor(parsed: DocxParsed, id: string): DocxBlock {
    const index = Number(/^docx:(\d+)$/.exec(id)?.[1]);
    const block = parsed.blocks[index];
    if (!block || !block.headingLevel) throw new Error('章节已变化，请刷新后重试。');
    return block;
}
function setLevel(block: DocxBlock, level: number): void {
    if (level < 1 || level > 6) throw new Error('标题层级必须介于 1 到 6。');
    const paragraph = block.element, document = paragraph.ownerDocument;
    let properties = first(paragraph, 'pPr');
    if (!properties) { properties = document.createElementNS(W, 'w:pPr'); paragraph.insertBefore(properties, paragraph.firstChild); }
    let style = first(properties, 'pStyle');
    if (!style) { style = document.createElementNS(W, 'w:pStyle'); properties.appendChild(style); }
    style.setAttributeNS(W, 'w:val', `Heading${level}`);
    let outline = first(properties, 'outlineLvl');
    if (!outline) { outline = document.createElementNS(W, 'w:outlineLvl'); properties.appendChild(outline); }
    outline.setAttributeNS(W, 'w:val', String(level - 1));
}
function paragraph(document: Document, text: string, level = 0, template?: Element): Element {
    const p = document.createElementNS(W, 'w:p');
    const properties = template && first(template, 'pPr');
    if (properties && !level) p.appendChild(properties.cloneNode(true));
    if (level) setLevel({ element: p, index: -1, headingLevel: level, title: text, text, complex: false }, level);
    const run = document.createElementNS(W, 'w:r'), value = document.createElementNS(W, 'w:t');
    value.appendChild(document.createTextNode(text)); value.setAttribute('xml:space', 'preserve');
    run.appendChild(value); p.appendChild(run); return p;
}
function replaceHeading(block: DocxBlock, title: string): void {
    if (!title.trim() || /[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(title))
        throw new Error('标题必须是非空的单行文字，且不能包含控制字符。');
    const element = block.element;
    const texts = descendants(element, 't');
    if (!texts.length) {
        const fresh = paragraph(element.ownerDocument, title.trim());
        while (fresh.firstChild) element.appendChild(fresh.firstChild);
        return;
    }
    texts[0].textContent = title.trim();
    texts[0].setAttribute('xml:space', 'preserve');
    for (const text of texts.slice(1)) text.textContent = '';
}
function directBody(parsed: DocxParsed, id: string): DocxBlock[] {
    if (id === 'document') return parsed.blocks.slice(0, parsed.blocks.findIndex(block => block.headingLevel) < 0
        ? parsed.blocks.length : parsed.blocks.findIndex(block => block.headingLevel));
    const heading = blockFor(parsed, id);
    let end = heading.index + 1;
    while (end < parsed.blocks.length && !parsed.blocks[end].headingLevel) end++;
    return parsed.blocks.slice(heading.index + 1, end);
}
export function editableDocxBody(parsed: DocxParsed, id: string): boolean {
    return directBody(parsed, id).every(block => !block.complex &&
        !descendants(block.element, 'rPr').length && !descendants(block.element, 'numPr').length &&
        !descendants(block.element, 'br').length && !descendants(block.element, 'tab').length);
}
export function docxBodyText(parsed: DocxParsed, id: string): string {
    return directBody(parsed, id).map(block => block.text).join('\n');
}
function apply(parsed: DocxParsed, operation: DocxOperation): void {
    const blocks = parsed.blocks, body = parsed.body;
    if (operation.type === 'rename') { replaceHeading(blockFor(parsed, operation.id), operation.title); return; }
    if (operation.type === 'body') {
        if (!editableDocxBody(parsed, operation.id)) throw new Error('本节含复杂格式、图片或表格，正文只读。');
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(operation.text)) throw new Error('正文含不允许写入 DOCX 的控制字符。');
        const current = directBody(parsed, operation.id);
        const reference = current.length ? current[current.length - 1].element.nextSibling :
            operation.id === 'document' ? blocks[0]?.element ?? first(body, 'sectPr') : blockFor(parsed, operation.id).element.nextSibling;
        for (const block of current) body.removeChild(block.element);
        const lines = operation.text.replace(/\r\n?/g, '\n').split('\n');
        if (lines.length === 1 && !lines[0]) return;
        for (let index = 0; index < lines.length; index++)
            body.insertBefore(paragraph(parsed.xml, lines[index], 0, current[Math.min(index, current.length - 1)]?.element), reference ?? null);
        return;
    }
    if (operation.type === 'insert' && operation.id === 'document') {
        if (!operation.title.trim() || /[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(operation.title))
            throw new Error('标题必须是非空的单行文字，且不能包含控制字符。');
        body.insertBefore(paragraph(parsed.xml, operation.title.trim(), 1), first(body, 'sectPr') ?? null);
        return;
    }
    const source = blockFor(parsed, operation.id), start = source.index;
    const end = endOf(blocks, start, source.headingLevel);
    if (operation.type === 'delete') {
        if (operation.promoteChildren) {
            for (const block of blocks.slice(start + 1, end)) if (block.headingLevel) setLevel(block, block.headingLevel - 1);
            body.removeChild(source.element);
        } else for (const block of blocks.slice(start, end)) body.removeChild(block.element);
        return;
    }
    if (operation.type === 'level') {
        for (const block of blocks.slice(start, end)) if (block.headingLevel) setLevel(block, block.headingLevel + operation.delta);
        return;
    }
    if (operation.type === 'move' && operation.target === 'document') {
        if (operation.place !== 'child') throw new Error('文档根节点只能接收子章节。');
        if (source.headingLevel !== 1) for (const block of blocks.slice(start, end))
            if (block.headingLevel) setLevel(block, block.headingLevel + 1 - source.headingLevel);
        const reference = first(body, 'sectPr') ?? null;
        for (const block of blocks.slice(start, end)) body.insertBefore(block.element, reference);
        return;
    }
    const target = operation.type === 'move' ? blockFor(parsed, operation.target) : source;
    const targetEnd = endOf(blocks, target.index, target.headingLevel);
    let firstChild = target.index + 1;
    while (firstChild < targetEnd && !blocks[firstChild].headingLevel) firstChild++;
    const insertion = operation.place === 'before' ? target.element :
        operation.place === 'after' ? blocks[targetEnd]?.element ?? first(body, 'sectPr') ?? null :
            blocks[firstChild]?.element ?? first(body, 'sectPr') ?? null;
    const level = operation.place === 'child' ? target.headingLevel + 1 : target.headingLevel;
    if (operation.type === 'insert') {
        if (!operation.title.trim() || /[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(operation.title))
            throw new Error('标题必须是非空的单行文字，且不能包含控制字符。');
        if (level > 6) throw new Error('标题层级不能超过 6。');
        body.insertBefore(paragraph(parsed.xml, operation.title, level), insertion);
        return;
    }
    if (target.index >= start && target.index < end) throw new Error('不能把章节移动到自身内部。');
    const delta = level - source.headingLevel;
    if (delta) for (const block of blocks.slice(start, end)) if (block.headingLevel) setLevel(block, block.headingLevel + delta);
    for (const block of blocks.slice(start, end)) body.insertBefore(block.element, insertion);
}

export class DocxEditor {
    private static locks = new Map<string, Promise<unknown>>();
    private data: ArrayBuffer;
    private parsed: DocxParsed;
    private fingerprint: string;
    constructor(private app: App, private file: TFile, data: ArrayBuffer) {
        this.data = data; this.fingerprint = binaryFingerprint(data);
        this.parsed = parseDocx(data, file.path, file.basename);
    }
    get model(): MindMapModel { return this.parsed.model; }
    get raw(): ArrayBuffer { return this.data; }
    private serialized<T>(work: () => Promise<T>): Promise<T> {
        const prior = DocxEditor.locks.get(this.file.path) ?? Promise.resolve();
        const next = prior.catch(() => {}).then(work);
        DocxEditor.locks.set(this.file.path, next);
        void next.finally(() => { if (DocxEditor.locks.get(this.file.path) === next) DocxEditor.locks.delete(this.file.path); }).catch(() => {});
        return next;
    }
    body(id: string): { text: string; editable: boolean } {
        return { text: docxBodyText(this.parsed, id), editable: editableDocxBody(this.parsed, id) };
    }
    async execute(operation: DocxOperation): Promise<MindMapModel> {
        return this.serialized(async () => {
        const current = await this.app.vault.readBinary(this.file);
        if (binaryFingerprint(current) !== this.fingerprint) throw new Error('DOCX 已在外部修改，请刷新导图后重试。');
        const candidate = parseDocx(this.data, this.file.path, this.file.basename);
        apply(candidate, operation);
        candidate.entries['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(candidate.xml as any));
        const bytes = zipSync(candidate.entries), next = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const verified = parseDocx(next, this.file.path, this.file.basename);
        if (binaryFingerprint(await this.app.vault.readBinary(this.file)) !== this.fingerprint)
            throw new Error('DOCX 已在外部修改，请刷新导图后重试。');
        await this.app.vault.modifyBinary(this.file, next);
        this.data = next; this.fingerprint = binaryFingerprint(next); this.parsed = verified;
        return verified.model;
        });
    }
    async restore(snapshot: ArrayBuffer): Promise<MindMapModel> {
        return this.serialized(async () => {
        const current = await this.app.vault.readBinary(this.file);
        if (binaryFingerprint(current) !== this.fingerprint) throw new Error('DOCX 已在外部修改，不能撤销或重做。');
        const parsed = parseDocx(snapshot, this.file.path, this.file.basename);
        await this.app.vault.modifyBinary(this.file, snapshot);
        this.data = snapshot; this.fingerprint = binaryFingerprint(snapshot); this.parsed = parsed;
        return parsed.model;
        });
    }
}
