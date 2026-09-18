import { clone, ComposerDraft, ComposerNode, entries, moveNodes, newDraft, newNode, projectDraft, selectedRoots, siblingsOf } from './ComposerModel';

export const COMPOSER_TEMPLATES: Record<string, { title: string; sections: string[] }> = {
    blank: { title: 'Untitled', sections: [] },
    essay: { title: 'Essay', sections: ['Introduction', 'Main Argument', 'Evidence', 'Counterargument', 'Conclusion'] },
    project: { title: 'Project Plan', sections: ['Background', 'Goals', 'Scope', 'Milestones', 'Risks', 'Next Steps'] },
    meeting: { title: 'Meeting Notes', sections: ['Agenda', 'Discussion', 'Decisions', 'Action Items'] },
    research: { title: 'Research Notes', sections: ['Question', 'Background', 'Method', 'Findings', 'References'] },
    course: { title: 'Course Notes', sections: ['Overview', 'Key Concepts', 'Examples', 'Questions', 'Summary'] },
};
export function fromTemplate(key: string, folder = ''): ComposerDraft {
    const template = COMPOSER_TEMPLATES[key]; if (!template) throw new Error('Unknown template.');
    const draft = newDraft(folder); draft.root.title = template.title;
    draft.root.children = template.sections.map(title => newNode(title)); return draft;
}
export function duplicateDraft(source: ComposerDraft): ComposerDraft {
    const draft = clone(source), ids = new Map<string, string>();
    draft.draftId = newDraft().draftId; draft.createdAt = draft.updatedAt = Date.now(); delete draft.createdPath;
    for (const { node } of entries(draft, true)) { const id = newNode().id; ids.set(node.id, id); node.id = id; }
    draft.selection = ids.get(draft.selection) ?? draft.root.id;
    draft.selections = (draft.selections ?? []).map(id => ids.get(id)!).filter(Boolean);
    draft.focusNode = ids.get(draft.focusNode ?? '') ?? null; draft.root.title += ' (copy)'; return draft;
}
export function organizeSelection(draft: ComposerDraft, ids: string[], action: 'promote' | 'demote' | 'up' | 'down'): void {
    const roots = selectedRoots(draft, ids); if (!roots.length) return;
    const siblings = siblingsOf(draft, roots[0].node.id);
    if (roots.some(e => siblingsOf(draft, e.node.id) !== siblings)) throw new Error('Select sibling nodes for this operation.');
    const first = siblings.indexOf(roots[0].node), last = siblings.indexOf(roots[roots.length - 1].node);
    if (last - first + 1 !== roots.length) throw new Error('Select consecutive siblings for this operation.');
    const target = action === 'promote' ? roots[0].parent : action === 'down' ? siblings[last + 1] : siblings[first - 1];
    if (!target) throw new Error('There is no destination in that direction.');
    moveNodes(draft, roots.map(e => e.node.id), target.id, action === 'demote' ? 'child' : action === 'up' ? 'before' : 'after');
}
export function deleteSelection(draft: ComposerDraft, ids: string[], keep: boolean): void {
    const roots = selectedRoots(draft, ids);
    let next = draft.root.id;
    for (const entry of roots) {
        const siblings = siblingsOf(draft, entry.node.id), index = siblings.indexOf(entry.node);
        siblings.splice(index, 1, ...(keep ? entry.node.children : []));
        next = siblings[Math.min(index, siblings.length - 1)]?.id ?? entry.parent?.id ?? draft.root.id;
    }
    draft.selection = next; draft.selections = [next];
    if (!entries(draft).some(e => e.node.id === draft.focusNode)) draft.focusNode = null;
}
export type SearchScope = 'titles' | 'bodies' | 'everything';
export function searchDraft(draft: ComposerDraft, query: string, scope: SearchScope): string[] {
    const needle = query.trim().toLocaleLowerCase(); if (!needle) return [];
    return entries(draft, true).filter(({ node }) =>
        (scope !== 'bodies' && node.title.toLocaleLowerCase().includes(needle)) ||
        (scope !== 'titles' && node.body.toLocaleLowerCase().includes(needle))).map(e => e.node.id);
}
/** Focus/search only project visibility. Saved fold flags are never modified. */
export function composerProjection(draft: ComposerDraft, searchTarget?: string) {
    const model = projectDraft(draft), all = entries(draft), byId = new Map(all.map(e => [e.node.id, e]));
    const collapsed = new Set(all.filter(e => e.node.collapsed).map(e => e.node.id));
    const ancestors = (id: string) => { const result: string[] = []; let e = byId.get(id); while (e) { result.push(e.node.id); e = e.parent ? byId.get(e.parent.id) : undefined; } return result; };
    const focus = draft.focusNode;
    if (focus && byId.has(focus) && !searchTarget) {
        const visible = new Set(ancestors(focus));
        const visit = (node: ComposerNode) => { visible.add(node.id); node.children.forEach(visit); };
        visit(byId.get(focus)!.node);
        model.nodes = model.nodes.filter(n => visible.has(n.id)).map(n => ({ ...n, children: n.children.filter(id => visible.has(id)) }));
        for (const id of ancestors(focus)) if (id !== focus) collapsed.delete(id);
    }
    if (searchTarget) for (const id of ancestors(searchTarget)) collapsed.delete(id);
    return { model, collapsed };
}
export function draftStatistics(draft: ComposerDraft) {
    const all = entries(draft, true).filter(e => e.node !== draft.root), text = entries(draft, true).map(e => `${e.node.title}\n${e.node.body}`).join('\n');
    return { sections: all.filter(e => e.node.type === 'heading' && !e.unsorted).length,
        ideas: all.filter(e => e.node.type === 'idea').length, todos: all.filter(e => e.node.type === 'todo').length,
        completed: all.filter(e => e.node.type === 'todo' && e.node.checked).length, unsorted: all.filter(e => e.unsorted).length,
        words: (text.match(/[\u3400-\u9fff]|[\p{L}\p{N}]+/gu) ?? []).length };
}
export function outlineMarkdown(draft: ComposerDraft): string {
    const lines: string[] = [];
    const visit = (node: ComposerNode, depth: number) => {
        const title = node.title.replace(/[\r\n]+/g, ' ');
        lines.push(`${'  '.repeat(depth)}- ${node.type === 'todo' ? `[${node.checked ? 'x' : ' '}] ` : ''}${title}`);
        node.children.forEach(child => visit(child, depth + 1));
    };
    draft.root.children.forEach(node => visit(node, 0));
    if (draft.unsorted?.length) { lines.push('- Unsorted Ideas'); draft.unsorted.forEach(node => visit(node, 1)); }
    return lines.join('\n') + (lines.length ? '\n' : '');
}
