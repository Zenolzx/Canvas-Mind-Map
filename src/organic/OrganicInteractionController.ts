import type { MindMapModel } from '../core/MindMapModel';
import { OrganicViewState } from './OrganicViewState';
import { OrganicSearchController } from './OrganicSearchController';

/** Pure visibility and reading policy. Never edits the source model or durable folding. */
export class OrganicInteractionController {
    readonly search = new OrganicSearchController();
    private model?: MindMapModel;
    private lookup = new Map<string, MindMapModel['nodes'][number]>();
    constructor(readonly state: OrganicViewState) {}
    update(model: MindMapModel): void {
        this.model = model; this.lookup = new Map(model.nodes.map(n => [n.id, n])); this.search.update(model);
    }
    subtree(id: string): Set<string> {
        const ids = new Set<string>();
        const visit = (id: string) => { const n = this.lookup.get(id); if (!n || ids.has(id)) return; ids.add(id); n.children.forEach(visit); };
        visit(id); return ids;
    }
    ancestors(id: string): Set<string> {
        const ids = new Set<string>(); let parent = this.lookup.get(id)?.parentId;
        while (parent && !ids.has(parent)) { ids.add(parent); parent = this.lookup.get(parent)?.parentId; }
        return ids;
    }
    get focusPaused(): boolean {
        return !!(this.state.focusNode && this.search.current && !this.subtree(this.state.focusNode).has(this.search.current));
    }
    focus(id: string | null): void {
        this.state.focusNode = id;
        if (id && this.state.reading.rootNode && !this.subtree(id).has(this.state.reading.rootNode)) this.read(null);
    }
    read(id: string | null): void { this.state.reading = { rootNode: id, currentNode: id }; }
    toggle(id: string): void {
        const effective = this.projection()?.collapsed;
        if (effective?.has(id)) { this.state.collapsed.delete(id); return; }
        this.state.collapsed.add(id);
        const subtree = this.subtree(id);
        if (this.search.current && this.search.current !== id && subtree.has(this.search.current)) this.clearSearch();
        if (this.state.focusNode && this.state.focusNode !== id && subtree.has(this.state.focusNode)) this.focus(null);
        if (this.state.reading.currentNode && this.state.reading.currentNode !== id && subtree.has(this.state.reading.currentNode)) {
            if (this.state.reading.rootNode && this.subtree(this.state.reading.rootNode).has(id)) this.state.reading.currentNode = id;
            else this.read(null);
        }
    }
    readingStep(delta: number): string | undefined {
        const root = this.state.reading.rootNode;
        if (!root || !this.model) return;
        const scope = this.subtree(root);
        const order = this.model.nodes.filter(n => scope.has(n.id) && n.headingLevel > 0);
        if (!order.length) return;
        const index = order.findIndex(n => n.id === this.state.reading.currentNode);
        const next = order[Math.max(0, Math.min(order.length - 1, index + delta))].id;
        this.state.reading.currentNode = next; this.state.selectedNode = next; return next;
    }
    projection(): { model: MindMapModel; collapsed: Set<string> } | undefined {
        if (!this.model) return;
        const collapsed = new Set(this.state.collapsed);
        const reveal = (id: string | null | undefined) => { if (id) this.ancestors(id).forEach(id => collapsed.delete(id)); };
        reveal(this.search.current); reveal(this.state.reading.currentNode); reveal(this.state.focusNode);
        let model = this.model;
        if (this.state.focusNode && !this.focusPaused) {
            const ids = new Set([...this.subtree(this.state.focusNode), ...this.ancestors(this.state.focusNode)]);
            model = { ...model, nodes: model.nodes.filter(n => ids.has(n.id)).map(n => ({ ...n, children: n.children.filter(id => ids.has(id)) })) };
        }
        return { model, collapsed };
    }
    emphasized(): Set<string> | undefined {
        const id = this.state.reading.rootNode;
        return id ? new Set([...this.subtree(id), ...this.ancestors(id)]) : undefined;
    }
    clearSearch(): void { if (this.model) this.search.update(this.model, ''); }
}
