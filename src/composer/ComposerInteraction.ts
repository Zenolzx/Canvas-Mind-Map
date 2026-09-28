import { ComposerDraft, ComposerNode, DropPosition, entries, moveNodes, parkNodes, selectedRoots } from './ComposerModel';

export interface DropRect { left: number; top: number; right: number; bottom: number }
export interface DropTarget { id: string; rect: DropRect; inbox?: boolean; root?: boolean }
export interface DropHit { target: string; position: DropPosition }
const contains = (r: DropRect, x: number, y: number, margin = 0) =>
    x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;

/** Screen-space hit testing. Existing targets have a larger exit than entry region. */
export function hitDrop(x: number, y: number, targets: DropTarget[], previous?: DropHit): DropHit | undefined {
    const cards = targets.filter(t => t.id !== '@unsorted');
    const old = cards.find(t => t.id === previous?.target);
    const nearest = (list: DropTarget[]) => list.sort((a, b) => {
        const distance = (t: DropTarget) => Math.hypot(x - Math.max(t.rect.left, Math.min(x, t.rect.right)), y - Math.max(t.rect.top, Math.min(y, t.rect.bottom)));
        return distance(a) - distance(b);
    })[0];
    const target = nearest(cards.filter(t => contains(t.rect, x, y)))
        ?? (old && contains(old.rect, x, y, 24) ? old : undefined)
        ?? nearest(cards.filter(t => contains(t.rect, x, y, 12)))
        ?? targets.find(t => t.id === '@unsorted' && contains(t.rect, x, y));
    if (!target) return undefined;
    if (target.id === '@unsorted') return { target: target.id, position: 'child' };
    const r = target.rect, height = r.bottom - r.top;
    const before = r.top + height * (target.inbox ? .5 : .25), after = r.top + height * .75;
    let position: DropPosition = target.inbox ? (y < before ? 'before' : 'after') : y < before ? 'before' : y > after ? 'after' : 'child';
    if (previous?.target === target.id) {
        if (previous.position === 'before' && y <= before + 6) position = 'before';
        if (previous.position === 'after' && y >= (target.inbox ? before : after) - 6) position = 'after';
        if (previous.position === 'child' && !target.inbox && y >= before - 6 && y <= after + 6) position = 'child';
    }
    return { target: target.id, position };
}

/** Keep structural transfer and adoption in one history transaction. */
export function transferNodes(draft: ComposerDraft, ids: string[], hit: DropHit): void {
    if (ids.includes(draft.root.id)) throw new Error('The document root cannot be moved.');
    const roots = selectedRoots(draft, ids);
    const adopt = hit.target !== '@unsorted' && !entries(draft, true).find(e => e.node.id === hit.target)?.unsorted;
    const arriving = roots.filter(e => e.unsorted).map(e => e.node);
    if (hit.target === '@unsorted') parkNodes(draft, ids);
    else moveNodes(draft, ids, hit.target, hit.position);
    if (adopt) {
        const visit = (node: ComposerNode) => { if (node.type === 'idea') node.type = 'heading'; node.children.forEach(visit); };
        arriving.forEach(visit);
    }
    if (!entries(draft).some(e => e.node.id === draft.focusNode)) draft.focusNode = null;
}

export function plainPreview(body: string): string {
    return body.replace(/```[^\n]*|[#>*_`~\[\]]/g, '').replace(/\s+/g, ' ').trim();
}
