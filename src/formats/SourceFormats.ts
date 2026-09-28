import { App, loadPdfJs, TFile } from 'obsidian';
import { strFromU8, unzipSync } from 'fflate/browser';
import { DOMParser } from '@xmldom/xmldom';
import type { MindMapModel, MindMapNode } from '../core/MindMapModel';
import { buildMindMapModel } from '../core/MindMapModel';

export type SourceFormat = 'md' | 'docx' | 'pdf';
export const supportedSource = (file: TFile | undefined): file is TFile =>
    !!file && (file.extension === 'md' || file.extension === 'docx' || file.extension === 'pdf');

export interface SourceDocument {
    format: SourceFormat;
    model: MindMapModel;
    text: string;
    fingerprint: string;
    raw?: ArrayBuffer;
}

export function binaryFingerprint(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data); let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}
const nodeList = (parent: Node, name: string): Element[] => {
    const result: Element[] = [];
    for (let child = parent.firstChild; child; child = child.nextSibling)
        if (child.nodeType === 1 && (child as Element).localName === name) result.push(child as Element);
    return result;
};
const descendants = (parent: Node, name: string): Element[] => {
    const result: Element[] = [];
    const visit = (node: Node) => { for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1 && (child as Element).localName === name) result.push(child as Element);
        visit(child);
    } };
    visit(parent); return result;
};
const attr = (element: Element | undefined, name: string): string | undefined =>
    element?.getAttribute(`w:${name}`) ?? element?.getAttribute(name) ?? undefined;
const paraText = (element: Element): string => descendants(element, 't').map(item => item.textContent ?? '').join('');

export interface DocxBlock { element: Element; index: number; headingLevel: number; title: string; text: string; complex: boolean }
export interface DocxParsed { xml: Document; blocks: DocxBlock[]; body: Element; entries: Record<string, Uint8Array>; model: MindMapModel }

export function parseDocx(data: ArrayBuffer, path: string, title: string): DocxParsed {
    const entries = unzipSync(new Uint8Array(data));
    const documentPart = entries['word/document.xml'];
    if (!documentPart) throw new Error('DOCX 缺少 word/document.xml。');
    const parser = new DOMParser({ onError: level => {
        if (level !== 'warning') throw new Error('DOCX XML 格式无效。');
    } });
    const xml = parser.parseFromString(strFromU8(documentPart), 'application/xml') as unknown as Document;
    const body = descendants(xml, 'body')[0];
    if (!body) throw new Error('DOCX 缺少正文。');
    const styles = new Map<string, number>();
    const stylePart = entries['word/styles.xml'];
    if (stylePart) {
        const stylesXml = parser.parseFromString(strFromU8(stylePart), 'application/xml') as unknown as Document;
        for (const style of descendants(stylesXml, 'style')) {
            const id = attr(style, 'styleId'); if (!id) continue;
            const outline = descendants(style, 'outlineLvl')[0];
            const explicit = outline && Number(attr(outline, 'val'));
            const heading = /^(?:Heading|heading)([1-6])$/.exec(id);
            if (outline && Number.isInteger(explicit) && explicit >= 0 && explicit <= 5) styles.set(id, explicit + 1);
            else if (heading) styles.set(id, Number(heading[1]));
        }
    }
    const blocks: DocxBlock[] = [];
    for (let child = body.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1 || (child as Element).localName === 'sectPr') continue;
        const element = child as Element, index = blocks.length, text = paraText(element);
        const pPr = nodeList(element, 'pPr')[0];
        const level = pPr && descendants(pPr, 'outlineLvl')[0];
        const explicit = level && Number(attr(level, 'val'));
        const style = pPr && descendants(pPr, 'pStyle')[0];
        const styleId = attr(style, 'val');
        const headingStyle = /^(?:Heading|heading)([1-6])$/.exec(styleId ?? '');
        const headingLevel = element.localName === 'p' && text.trim()
            ? level && Number.isInteger(explicit) && explicit >= 0 && explicit <= 5 ? explicit + 1 :
                styles.get(styleId ?? '') ?? (headingStyle ? Number(headingStyle[1]) : 0) : 0;
        const complex = element.localName !== 'p' || descendants(element, 'drawing').length > 0 ||
            descendants(element, 'object').length > 0 || descendants(element, 'fldChar').length > 0 ||
            descendants(element, 'ins').length > 0 || descendants(element, 'del').length > 0 ||
            descendants(element, 'hyperlink').length > 0;
        blocks.push({ element, index, headingLevel, title: text.trim(), text, complex });
    }
    const root: MindMapNode = { id: 'document', key: '', title, content: '', headingLevel: 0, depth: 0,
        children: [], source: { file: path, line: 0, endLine: blocks.length } };
    const nodes: MindMapNode[] = [root], stack: MindMapNode[] = [root];
    const headings = blocks.filter(block => block.headingLevel);
    for (let i = 0; i < headings.length; i++) {
        const block = headings[i];
        while (stack.length > 1 && stack[stack.length - 1].headingLevel >= block.headingLevel) stack.pop();
        const parent = stack[stack.length - 1];
        const end = headings[i + 1]?.index ?? blocks.length;
        const content = blocks.slice(block.index + 1, end).map(item => item.text).filter(Boolean).join('\n');
        const node: MindMapNode = { id: `docx:${block.index}`, key: `docx:${block.index}`, title: block.title,
            content, headingLevel: block.headingLevel, depth: stack.length, parentId: parent.id, children: [],
            source: { file: path, line: block.index, endLine: end } };
        parent.children.push(node.id); nodes.push(node); stack.push(node);
    }
    root.content = blocks.slice(0, headings[0]?.index ?? blocks.length).map(item => item.text).filter(Boolean).join('\n');
    return { xml, blocks, body, entries, model: { rootId: root.id, nodes, sourceFile: path } };
}

async function parsePdf(data: ArrayBuffer, path: string, title: string): Promise<MindMapModel> {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
    let pdf: any;
    try {
        pdf = await task.promise;
        const pages: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
            const content = await (await pdf.getPage(index)).getTextContent();
            pages.push(content.items.map((item: { str?: string }) => item.str ?? '').join(' ').trim());
        }
        if (!pages.some(page => page.length)) throw new Error('PDF 没有可提取的文字；扫描件暂不支持。');
        const root: MindMapNode = { id: 'document', key: '', title, content: pages.join('\n\n'), headingLevel: 0,
            depth: 0, children: [], source: { file: path, line: 1, endLine: pdf.numPages } };
        const nodes = [root];
        const outline = await pdf.getOutline();
        const visit = async (items: any[], parent: MindMapNode, level: number, prefix: string) => {
            for (let index = 0; index < items.length; index++) {
                const item = items[index]; let page = 1;
                try {
                    const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
                    if (destination?.[0]) page = (await pdf.getPageIndex(destination[0])) + 1;
                } catch { /* Keep an unresolvable bookmark visible at the document start. */ }
                const id = `pdf:${prefix}${index}`;
                const node: MindMapNode = { id, key: id, title: String(item.title || `Page ${page}`), content: pages[page - 1] ?? '',
                    headingLevel: Math.min(level, 6), depth: level, parentId: parent.id, children: [],
                    source: { file: path, line: page, endLine: page } };
                parent.children.push(id); nodes.push(node);
                if (item.items?.length) await visit(item.items, node, level + 1, `${prefix}${index}/`);
            }
        };
        if (outline?.length) await visit(outline, root, 1, '');
        for (let index = 1; index < nodes.length; index++) {
            const node = nodes[index], start = Math.max(1, node.source.line);
            const nextPage = nodes[index + 1]?.source.line ?? pdf.numPages + 1;
            const end = Math.max(start, nextPage - 1);
            node.source.endLine = end;
            node.content = pages.slice(start - 1, end).join('\n\n');
        }
        return { rootId: root.id, nodes, sourceFile: path };
    } finally { await pdf?.destroy?.(); await task.destroy?.(); }
}

export async function readSourceDocument(app: App, file: TFile): Promise<SourceDocument> {
    if (!supportedSource(file)) throw new Error('不支持的文件格式。');
    if (file.extension === 'md') {
        const text = await app.vault.read(file);
        return { format: 'md', text, fingerprint: `${text.length}:${text}`, model: buildMindMapModel(text, { title: file.basename, file: file.path }) };
    }
    const raw = await app.vault.readBinary(file), fingerprint = binaryFingerprint(raw);
    if (file.extension === 'docx') {
        const parsed = parseDocx(raw, file.path, file.basename);
        return { format: 'docx', raw, fingerprint, model: parsed.model, text: parsed.model.nodes.map(n => n.content).join('\n') };
    }
    return { format: 'pdf', raw, fingerprint, model: await parsePdf(raw, file.path, file.basename), text: '' };
}
