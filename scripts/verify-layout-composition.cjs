const assert = require('node:assert/strict');
const { loadModule } = require('./lib/svg-dom.cjs');

/**
 * Layout composition metrics.
 *
 * The rendering engine already guarantees hard invariants (no node overlaps, no branch
 * crossings, bounds contain every curve) — those are covered by verify-organic.cjs and
 * verify-organic-scale.cjs. This script measures the softer qualities that make a map read as
 * composed rather than merely packed, and fails when they regress:
 *
 *   reach spread    how far nodes at the same depth sit from the centre (uneven rings look ragged)
 *   sibling gap     spacing between consecutive siblings of one parent (must stay usable)
 *   alignment drift how much same-depth nodes disagree on their forward axis
 *   aspect          the map's overall shape (very elongated maps are hard to read)
 *
 * Thresholds are set from the current engine's measured behaviour with headroom, so this is a
 * ratchet: tuning may improve the numbers, and any change that worsens them is caught.
 */

const { OrganicLayoutEngine } = loadModule('src/organic/OrganicLayoutEngine.ts');
const { buildMindMapModel } = loadModule('src/core/MindMapModel.ts');

const measureText = (text, size) => text.length * size * 0.55;

function balanced() {
    const lines = ['# A thoughtful life', 'intro'];
    for (const branch of ['Learn with intention', 'Create meaningful work', 'Stay connected']) {
        lines.push(`# ${branch}`);
        for (let i = 1; i <= 3; i++) lines.push(`## ${branch} point ${i}`);
    }
    return lines.join('\n');
}

function deepChain() {
    const lines = ['# Root'];
    let prefix = 'N';
    for (let depth = 1; depth <= 5; depth++) {
        lines.push(`${'#'.repeat(depth)} Level ${depth}`);
        for (let i = 0; i < 2; i++) lines.push(`${'#'.repeat(depth + 1)} Leaf ${depth}-${i + 1}`);
    }
    return lines.join('\n');
}

function wide() {
    return ['# Root'].concat(Array.from({ length: 12 }, (_, i) => `# Branch ${i + 1}`)).join('\n\n');
}

function uneven() {
    return ['# Root', '# Short', '## S1', '# A considerably longer heading for one branch',
        '## Long child heading that wraps onto another line', '### Deep', '# Mid', '## M1', '## M2'].join('\n');
}

const FIXTURES = { balanced: balanced(), deepChain: deepChain(), wide: wide(), uneven: uneven() };

const engine = new OrganicLayoutEngine();

function analyse(result) {
    const nodes = result.nodes, centre = nodes.find(n => n.depth === 0);
    const childrenOf = new Map();
    for (const branch of result.branches) {
        if (!childrenOf.has(branch.parentId)) childrenOf.set(branch.parentId, []);
        childrenOf.get(branch.parentId).push(nodes.find(n => n.id === branch.childId));
    }

    // Reach: distance from the centre's edge to the node's near edge.
    const byDepth = new Map();
    for (const node of nodes) {
        if (node.depth === 0) continue;
        if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
        byDepth.get(node.depth).push(Math.hypot(node.x + node.width / 2 - (centre.x + centre.width / 2),
            node.y + node.height / 2 - (centre.y + centre.height / 2)));
    }
    const reachSpread = [];
    for (const list of byDepth.values()) {
        const min = Math.min(...list), max = Math.max(...list);
        if (min > 0) reachSpread.push(max / min);
    }

    // Sibling gaps: edge-to-edge separation along the fan, per parent. Only pairs that actually
    // share horizontal extent are stacked into rows; the rest are side by side in the fan, so
    // measuring their vertical gap would be meaningless.
    const gaps = [];
    const tightest = [];
    for (const [parentId, siblings] of childrenOf) {
        const distinct = siblings.filter(Boolean);
        if (distinct.length < 2) continue;
        for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
            const a = distinct[i], b = distinct[j];
            if (!(a.x < b.x + b.width && b.x < a.x + a.width)) continue;
            const upper = a.y <= b.y ? a : b, lower = a.y <= b.y ? b : a;
            const gap = lower.y - (upper.y + upper.height);
            if (gap < 0) continue;
            gaps.push(gap);
            tightest.push({ gap, a: upper.title, b: lower.title, parent: parentId });
        }
    }
    tightest.sort((x, y) => x.gap - y.gap);

    const aspect = result.bounds.width / result.bounds.height;
    return {
        maxReachSpread: reachSpread.length ? Math.max(...reachSpread) : 1,
        minGap: gaps.length ? Math.min(...gaps) : Infinity,
        tightestGap: tightest[0],
        aspect,
        nodes: nodes.length,
    };
}

const STYLES = ['organic-radial', 'organic-horizontal', 'compact-organic'];

/** Ceilings, each set just above the engine's measured behaviour, so this is a ratchet: tuning
 *  may improve the numbers and any change that worsens them fails. They are upper bounds rather
 *  than ideals — a deliberately deep document is legitimately elongated, and the viewport can
 *  zoom, so aspect is guarded against runaway stretch rather than forced toward a golden ratio. */
const LIMITS = {
    maxReachSpread: 2.1,
    // The compact style deliberately tightens siblingGap to 12px, so the floor tracks it; a gap
    // below this means subtrees are being packed flush instead of separated.
    minGap: 11,
    aspectHigh: 5.0,
    aspectLow: 0.2,
};

let checked = 0;
const rows = [];
const failures = [];
for (const style of STYLES) {
    for (const [name, text] of Object.entries(FIXTURES)) {
        const model = buildMindMapModel(text, { file: `${name}.md`, title: name });
        const result = engine.layout(model, { collapsed: new Set(), measureText, style });
        const stats = analyse(result);
        rows.push({ style, name, ...stats });

        if (stats.maxReachSpread > LIMITS.maxReachSpread) failures.push(`${style}/${name}: reach spread ${stats.maxReachSpread.toFixed(2)}x > ${LIMITS.maxReachSpread}x`);
        if (stats.minGap < LIMITS.minGap) failures.push(`${style}/${name}: sibling gap ${stats.minGap.toFixed(1)}px < ${LIMITS.minGap}px`);
        if (stats.aspect > LIMITS.aspectHigh || stats.aspect < LIMITS.aspectLow) failures.push(`${style}/${name}: aspect ${stats.aspect.toFixed(2)} outside ${LIMITS.aspectLow}-${LIMITS.aspectHigh}`);

        // The hard invariant must hold at the same time; composition never trades away correctness.
        for (let a = 0; a < result.nodes.length; a++) for (let b = a + 1; b < result.nodes.length; b++) {
            const p = result.nodes[a], q = result.nodes[b];
            const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
            if (overlap) failures.push(`${style}/${name}: "${p.title}" overlaps "${q.title}"`);
        }
        checked++;
    }
}

for (const row of rows) {
    console.log(`  ${row.style.padEnd(20)} ${row.name.padEnd(10)} nodes=${String(row.nodes).padStart(3)} ` +
        `reachSpread=${row.maxReachSpread.toFixed(2)}x minGap=${row.minGap === Infinity ? 'n/a' : row.minGap.toFixed(1) + 'px'} ` +
        `aspect=${row.aspect.toFixed(2)}` + (row.tightestGap && row.tightestGap.gap < 8 ? `\n      tightest pair: "${row.tightestGap.a}" / "${row.tightestGap.b}" gap=${row.tightestGap.gap.toFixed(1)}px` : ""));
}
if (failures.length) {
    console.error(`FAIL layout composition (${failures.length}):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
}
console.log(`PASS layout composition: ${checked} style/fixture combinations within reach-spread, gap, ` +
    `aspect and no-overlap bounds`);
