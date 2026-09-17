import MarkdownIt from 'markdown-it';
import { DOCUMENT_ROOT, DocumentSection, DocumentStructure, SourceRange, StructureDiagnostic, StructureError } from './DocumentStructure';

interface SourceLine { start: number; end: number; contentEnd: number; text: string }
export interface ParseOptions {
    sourcePath: string;
    revision?: number;
    /** Only deterministic transaction-produced anchors may be supplied here. */
    identities?: ReadonlyMap<number, string>;
}
let sequence = 0;
export function newSectionId(): string { return `section:${++sequence}`; }

function sourceLines(text: string): SourceLine[] {
    const lines: SourceLine[] = [];
    const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
        lines.push({ start: match.index, contentEnd: match.index + match[1].length,
            end: match.index + match[0].length, text: match[1] });
        if (!match[0].length || pattern.lastIndex === text.length) break;
    }
    return lines;
}

/** Block parsing finds structure; original source slices remain the only writable content. */
export class DocumentStructureParser {
    private markdown = new MarkdownIt('commonmark', { html: true });
    constructor() {
        // Obsidian block comments and display math must shield heading-looking text.
        this.markdown.block.ruler.before('fence', 'obsidian_opaque', (state, start, end, silent) => {
            const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
            const delimiter = line.startsWith('%%') ? '%%' : line.startsWith('$$') ? '$$' : undefined;
            if (!delimiter || state.sCount[start] - state.blkIndent >= 4) return false;
            if (silent) return true;
            let next = start + 1, closed = line.indexOf(delimiter, 2) >= 0;
            while (!closed && next < end) {
                const current = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
                closed = current.includes(delimiter); next++;
            }
            const token = state.push('obsidian_opaque', '', 0);
            token.block = true; token.map = [start, next]; token.meta = { closed, delimiter };
            state.line = next;
            return true;
        }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    }

    parse(text: string, options: ParseOptions): DocumentStructure {
        const lines = sourceLines(text), diagnostics: StructureDiagnostic[] = [];
        const bomEnd = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
        let preludeEnd = bomEnd, frontmatter: SourceRange | null = null;
        let parseText = bomEnd ? ' ' + text.slice(1) : text;
        if (lines[0]?.text.slice(bomEnd).trim() === '---') {
            const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)[\t ]*$/.test(line.text));
            if (close < 0) {
                diagnostics.push({ code: 'unclosed-frontmatter', message: 'Close the frontmatter before editing document structure.', range: { start: bomEnd, end: text.length } });
                preludeEnd = text.length;
            } else preludeEnd = lines[close].end;
            frontmatter = { start: bomEnd, end: preludeEnd };
            parseText = text.slice(0, preludeEnd).replace(/[^\r\n]/g, ' ') + text.slice(preludeEnd);
        }
        const tokens = this.markdown.parse(parseText, {});
        const sections: DocumentSection[] = [];
        const offset = (line: number) => lines[line]?.start ?? text.length;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!token.map) continue;
            const [first, last] = token.map;
            const range = { start: offset(first), end: offset(last) };
            if (token.type === 'obsidian_opaque' && !token.meta?.closed) diagnostics.push({
                code: 'unclosed-opaque-block', message: 'Close the comment or math block before structural editing.', range });
            if (token.type === 'fence') {
                const tail = (lines[last - 1]?.text ?? '').replace(/^(?: {0,3}>[\t ]?)+/, '').trim();
                const marker = token.markup[0];
                if (last - first < 2 || !new RegExp(`^${marker === '`' ? '`' : '~'}{${token.markup.length},}[\\t ]*$`).test(tail))
                    diagnostics.push({ code: 'unclosed-fence', message: 'Close the code fence before structural editing.', range });
            }
            // Inline/mixed multiline %% comments need a dedicated Obsidian inline grammar.
            // Keep reading possible, but never guess writable ranges in these documents.
            if (token.type === 'inline' && token.content.includes('%%')) diagnostics.push({
                code: 'inline-comment', message: 'Inline %% comments are not yet supported for structural editing; use standalone comment blocks.', range });
            if (token.type === 'inline' && token.content.includes('$$')) diagnostics.push({
                code: 'inline-display-math', message: 'Use standalone $$ math blocks before structural editing; inline display-math boundaries are ambiguous.', range });
            if (token.type === 'inline' && token.content.includes('<!--') && !token.content.includes('-->')) diagnostics.push({
                code: 'inline-html-comment', message: 'A multiline HTML comment starts inside a paragraph. Move it into a standalone block before structural editing.', range });
            if (token.type !== 'heading_open' || token.level !== 0) continue;
            const line = lines[first];
            const begin = line.start + (first === 0 ? bomEnd : 0);
            const raw = text.slice(begin, line.contentEnd);
            const atx = /^( {0,3})(#{1,6})([\t ]*)(.*)$/.exec(raw);
            let title: SourceRange, marker: SourceRange, style: 'atx' | 'setext';
            if (atx) {
                style = 'atx';
                marker = { start: begin + atx[1].length, end: begin + atx[1].length + atx[2].length };
                const titleStart = marker.end + atx[3].length;
                const value = atx[4].replace(/[\t ]+#+[\t ]*$/, '').replace(/[\t ]+$/, '');
                // A heading consisting solely of closing hashes has no title.
                const emptyClosing = /^#+[\t ]*$/.test(atx[4]) && atx[3].length > 0;
                title = { start: titleStart, end: titleStart + (emptyClosing ? 0 : value.length) };
            } else {
                style = 'setext';
                const underline = lines[last - 1];
                const leading = raw.match(/^ */)![0].length;
                const trailing = text.slice(begin, lines[last - 2].contentEnd).match(/[\t ]*$/)![0].length;
                title = { start: begin + leading, end: lines[last - 2].contentEnd - trailing };
                const underlineStart = underline.start + underline.text.match(/^ */)![0].length;
                marker = { start: underlineStart, end: underlineStart + underline.text.trim().length };
                if (last - first !== 2) diagnostics.push({ code: 'multiline-setext',
                    message: 'Multiline Setext titles are read-only in this engine version.', range });
            }
            const id = options.identities?.get(begin) ?? newSectionId();
            sections.push({ id, sourcePath: options.sourcePath, line: first, depth: 1,
                headingText: text.slice(title.start, title.end), headingLevel: Number(token.tag.slice(1)),
                headingStyle: style, heading: { start: begin, end: range.end }, title, marker,
                body: { start: range.end, end: text.length }, subtree: { start: begin, end: text.length },
                parentId: DOCUMENT_ROOT, children: [] });
        }
        const stack: number[] = [];
        const children = new Map<string, string[]>(), roots: string[] = [];
        for (let i = 0; i < sections.length; i++) {
            let section = sections[i];
            while (stack.length && sections[stack[stack.length - 1]].headingLevel >= section.headingLevel) {
                const index = stack.pop()!;
                sections[index] = { ...sections[index], subtree: { start: sections[index].heading.start, end: section.heading.start } };
            }
            const parent = stack.length ? sections[stack[stack.length - 1]] : undefined;
            const parentId = parent?.id ?? DOCUMENT_ROOT;
            section = { ...section, parentId, depth: parent ? parent.depth + 1 : 1,
                body: { start: section.heading.end, end: sections[i + 1]?.heading.start ?? text.length } };
            sections[i] = section; children.set(section.id, []);
            if (parent) children.get(parent.id)!.push(section.id); else roots.push(section.id);
            stack.push(i);
        }
        const map = new Map<string, DocumentSection>();
        for (const section of sections) {
            if (map.has(section.id) || section.id === DOCUMENT_ROOT) throw new StructureError('invalid-identity', 'Section identities must be unique.');
            map.set(section.id, Object.freeze({ ...section, children: Object.freeze(children.get(section.id)!) }));
        }
        const firstHeading = sections[0]?.heading.start ?? text.length;
        return Object.freeze({ sourcePath: options.sourcePath, revision: options.revision ?? 0, text,
            rootId: DOCUMENT_ROOT, bom: { start: 0, end: bomEnd }, frontmatter,
            introduction: { start: preludeEnd, end: firstHeading }, sections: map,
            order: Object.freeze(sections.map(s => s.id)), roots: Object.freeze(roots), diagnostics: Object.freeze(diagnostics),
            defaultEol: text.match(/\r\n|\n|\r/)?.[0] ?? '\n' });
    }
}
