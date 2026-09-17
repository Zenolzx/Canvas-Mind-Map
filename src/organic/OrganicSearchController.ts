import type { MindMapModel } from '../core/MindMapModel';
export class OrganicSearchController {
    query = '';
    results: string[] = [];
    index = -1;
    get current(): string | undefined { return this.results[this.index]; }
    update(model: MindMapModel, query = this.query): void {
        const current = this.current;
        this.query = query;
        const needle = query.trim().toLocaleLowerCase();
        this.results = needle ? model.nodes.filter(n => n.headingLevel > 0 && n.title.toLocaleLowerCase().includes(needle)).map(n => n.id) : [];
        const index = current ? this.results.indexOf(current) : -1;
        this.index = index >= 0 ? index : this.results.length ? 0 : -1;
    }
    move(delta: number): string | undefined {
        if (this.results.length) this.index = (this.index + delta + this.results.length) % this.results.length;
        return this.current;
    }
}
