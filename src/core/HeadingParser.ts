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
        const line = lines[i];
        if (yaml) {
            if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false;
            continue;
        }
        const code = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (code && code[1][0] === fence && code[1].length >= fenceLength && !code[2].trim()) fence = '';
            previousText = false;
            continue;
        }
        if (code && (code[1][0] !== '`' || !code[2].includes('`'))) {
            fence = code[1][0]; fenceLength = code[1].length;
            previousText = false;
            continue;
        }
        const atx = line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.*?)|[\t ]*)$/);
        if (atx) {
            starts.push({ line: i, level: atx[1].length,
                title: (atx[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim() });
            previousText = false;
        } else if (previousText && /^ {0,3}(=+|-+)\s*$/.test(line)) {
            starts.push({ line: i - 1, level: line.trim()[0] === '=' ? 1 : 2, title: lines[i - 1].trim() });
            previousText = false;
        } else {
            previousText = !!line.trim() && !/^( {4}|\t| {0,3}[>\-*+]| {0,3}\d+[.)]\s)/.test(line);
        }
    }
    const result: HeadingSection[] = [], stack: number[] = [];
    const occurrences = new Map<string, number>();
    starts.forEach((heading, index) => {
        while (stack.length && result[stack[stack.length - 1]].level >= heading.level) stack.pop();
        const parent = stack.length ? stack[stack.length - 1] : -1;
        const path = `${parent < 0 ? '' : result[parent].key}/${encodeURIComponent(heading.title)}`;
        const count = (occurrences.get(path) ?? 0) + 1;
        occurrences.set(path, count);
        result.push({ line: heading.line, endLine: starts[index + 1]?.line ?? lines.length, level: heading.level, title: heading.title,
            content: lines.slice(heading.line, starts[index + 1]?.line ?? lines.length).join('\n').trimEnd(),
            key: `${path}:${count}`, parent, depth: parent < 0 ? 1 : result[parent].depth + 1 });
        stack.push(index);
    });
    return result;
}


