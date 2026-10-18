export interface HeadingSection {
    line: number;
    endLine: number;
    level: number;
    title: string;
    content: string;
    key: string;
    parent: number;
    depth: number;
}

/** ATX + Setext headings, excluding YAML, fenced code and indented code. */
export function parseHeadings(text: string): HeadingSection[] {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const starts: { line: number; level: number; title: string }[] = [];
    let fence = '', fenceLength = 0;
    let yaml = lines[0]?.trim() === '---' && lines.slice(1).some(line => /^(---|\.\.\.)\s*$/.test(line));
    let previousText = false;
    for (let i = 0; i < lines.length; i++) {
        // Array access is checked under noUncheckedIndexedAccess; an absent line is empty.
        const line = lines[i] ?? '';
        if (yaml) {
            if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false;
            continue;
        }
        const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        const marker = code?.[1], trailing = code?.[2] ?? '';
        if (fence) {
            if (marker && marker[0] === fence && marker.length >= fenceLength && !trailing.trim()) fence = '';
            previousText = false;
            continue;
        }
        if (marker && (marker[0] !== '`' || !trailing.includes('`'))) {
            fence = marker[0]!; fenceLength = marker.length;
            previousText = false;
            continue;
        }
        const atx = /^ {0,3}(#{1,6})(?:[\t ]+(.*?)|[\t ]*)$/.exec(line);
        if (atx) {
            starts.push({ line: i, level: atx[1]?.length ?? 0,
                title: (atx[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim() });
            previousText = false;
        } else if (previousText && /^ {0,3}(=+|-+)\s*$/.test(line)) {
            const level = line.trim().startsWith('=') ? 1 : 2;
            const title = lines[i - 1];
            // A Setext heading always has the paragraph line above it, but guard regardless.
            if (title !== undefined) starts.push({ line: i - 1, level, title: title.trim() });
            previousText = false;
        } else {
            previousText = !!line.trim() && !/^( {4}|\t| {0,3}[>\-*+]| {0,3}\d+[.)]\s)/.test(line);
        }
    }
    const result: HeadingSection[] = [], stack: number[] = [];
    const occurrences = new Map<string, number>();
    starts.forEach((heading, index) => {
        while (stack.length) {
            const top = stack[stack.length - 1]!;
            if ((result[top]?.level ?? 0) < heading.level) break;
            stack.pop();
        }
        const parent = stack.length ? stack[stack.length - 1]! : -1;
        const parentSection = parent < 0 ? undefined : result[parent];
        const path = `${parentSection ? parentSection.key : ''}/${encodeURIComponent(heading.title)}`;
        const count = (occurrences.get(path) ?? 0) + 1;
        occurrences.set(path, count);
        result.push({ line: heading.line, endLine: starts[index + 1]?.line ?? lines.length, level: heading.level, title: heading.title,
            content: lines.slice(heading.line, starts[index + 1]?.line ?? lines.length).join('\n').trimEnd(),
            key: `${path}:${count}`, parent, depth: parentSection ? parentSection.depth + 1 : 1 });
        stack.push(index);
    });
    return result;
}


