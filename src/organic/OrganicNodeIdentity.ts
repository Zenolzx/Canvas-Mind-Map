import type { MindMapModel } from '../core/MindMapModel';
import { sourceFingerprint } from './OrganicViewState';

export interface OrganicIdentity {
    id: string; key: string; title: string; body: string; level: number; line: number;
}
let sequence = 0;
/** The shared parser's keys remain untouched. Organic gets an independent identity namespace. */
export function reconcileOrganicModel(model: MindMapModel, previous: OrganicIdentity[] = [], identical = false): {
    model: MindMapModel; identities: OrganicIdentity[];
} {
    const descriptors = model.nodes.map(node => {
        const lines = node.content.split('\n');
        const body = lines.slice(/^ {0,3}(=+|-+)\s*$/.test(lines[1] ?? '') ? 2 : 1).join('\n').trim();
        return { id: '', key: node.key, title: node.title, body: body ? sourceFingerprint(body) : '',
            level: node.headingLevel, line: node.source.line };
    });
    const used = new Set<string>();
    const match = (signature: (n: OrganicIdentity) => string, allowed: (n: OrganicIdentity) => boolean = () => true) => {
        const old = new Map<string, OrganicIdentity[]>(), next = new Map<string, OrganicIdentity[]>();
        for (const n of previous) if (!used.has(n.id) && allowed(n)) old.set(signature(n), [...(old.get(signature(n)) ?? []), n]);
        for (const n of descriptors) if (!n.id && allowed(n)) next.set(signature(n), [...(next.get(signature(n)) ?? []), n]);
        for (const [key, nodes] of next) if (nodes.length === 1 && old.get(key)?.length === 1) {
            nodes[0].id = old.get(key)![0].id; used.add(nodes[0].id);
        }
    };
    const unchangedSections = previous.length === descriptors.length && previous.every((n, i) => {
        const next = descriptors[i];
        return n.key === next.key && n.title === next.title && n.body === next.body && n.level === next.level;
    });
    if (identical || unchangedSections) match(n => n.key);
    else {
        // Unique complete sections survive parent moves and heading level changes.
        match(n => `${n.title}\u0000${n.body}`, n => !!n.key && !!n.body);
        // Title plus hierarchy, never title alone. Cross-parent moves require preserved body evidence above.
        const unique = (n: OrganicIdentity) => !!n.key &&
            previous.filter(p => p.title === n.title).length === 1 && descriptors.filter(p => p.title === n.title).length === 1;
        match(n => n.key, unique);
        // A rename is accepted only when a unique nonempty body is preserved.
        match(n => `${n.key.slice(0, n.key.lastIndexOf('/'))}\u0000${n.body}`, n => !!n.key && !!n.body);
        match(() => 'document', n => !n.key);
        const newNodes = new Set(descriptors);
        const oldByKey = new Map(previous.map(n => [n.key, n])), newByKey = new Map(descriptors.map(n => [n.key, n]));
        const parentIdentity = (n: OrganicIdentity) => (newNodes.has(n) ? newByKey : oldByKey).get(n.key.slice(0, n.key.lastIndexOf('/')))?.id;
        // A matched parent's identity anchors uniquely named children after a parent rename/move.
        for (let depth = 0; depth < 6; depth++) match(n => `${parentIdentity(n)}\u0000${n.title}`, n => !!n.key && !!parentIdentity(n));
    }
    for (const n of descriptors) if (!n.id) n.id = `organic:${Date.now().toString(36)}:${(++sequence).toString(36)}`;
    const mapping = new Map(model.nodes.map((n, i) => [n.id, descriptors[i].id]));
    return { identities: descriptors, model: { ...model, rootId: mapping.get(model.rootId)!,
        nodes: model.nodes.map(n => ({ ...n, id: mapping.get(n.id)!, parentId: n.parentId ? mapping.get(n.parentId) : undefined,
            children: n.children.map(id => mapping.get(id)!) })) } };
}
