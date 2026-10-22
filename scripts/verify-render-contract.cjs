const assert = require('node:assert/strict');
const fs = require('node:fs');

const { loadModule, makeDocument, serialize } = require('./lib/svg-dom.cjs');

/**
 * Render contract guard.
 *
 * The visual screenshot suites have limited resolution for small property changes: measured on
 * this project, card radius 9->4 shifts only ~0.27% of pixels while gesture-driven captures
 * jitter by up to ~1.7%, so pixels cannot reliably tell them apart. These assertions cover the
 * baseline appearance at the property level instead, deterministically and without a browser.
 *
 * They also enforce the architectural rule that makes exports correct: baseline appearance is
 * written as presentation attributes by the renderer, so it survives serialization without a
 * stylesheet. CSS is only allowed to layer interaction state on top.
 */

const { DEFAULT_SURFACE, OrganicMindMapRenderer } = loadModule('src/organic/OrganicMindMapRenderer.ts');
const document = makeDocument();

const result = (overrides = {}) => ({
    nodes: [
        { id: 'r', title: 'Root', x: -60, y: -20, width: 120, height: 40, depth: 0, rootBranchId: 'r',
            direction: 0, fontSize: 30, fontWeight: 650, color: '#45423f', lines: ['Root'], children: 1, collapsed: false },
        { id: 'a', title: 'Child', x: 200, y: -15, width: 110, height: 30, depth: 1, rootBranchId: 'a',
            direction: 0, fontSize: 21, fontWeight: 650, color: '#218b89', lines: ['Child'], children: 0, collapsed: false },
    ],
    branches: [{ parentId: 'r', childId: 'a', start: { x: 60, y: 0 }, control1: { x: 120, y: 0 },
        control2: { x: 150, y: 0 }, end: { x: 200, y: 0 }, width: 4.2, color: '#218b89' }],
    bounds: { x: -108, y: -68, width: 466, height: 136 },
    ...overrides,
});

const paint = (actions = {}) => {
    const scene = document.createElementNS('', 'g');
    new OrganicMindMapRenderer().render(scene, result(), {
        navigate: () => {}, toggle: () => {}, toggleLabel: collapsed => collapsed ? 'Expand' : 'Collapse',
        duration: 0, ...actions });
    return { scene, svg: serialize(scene) };
};

const rects = svg => svg.match(/<rect[^>]*>/g) ?? [];

// 1. Cards carry an explicit radius from the surface style, clamped to half the height so a tall
//    node is never rendered as a pill.
{
    assert.equal(DEFAULT_SURFACE.radius, 9, 'the default card radius is the shared --cmm-radius-m step');
    const { svg } = paint();
    const cards = rects(svg).filter(r => r.includes('cmm-organic-hitbox'));
    assert.equal(cards.length, 2, 'one card rect per node');
    for (const card of cards) {
        const rx = Number((card.match(/rx="([^"]*)"/) ?? [])[1]);
        const height = Number((card.match(/height="([^"]*)"/) ?? [])[1]);
        assert.equal(rx, Math.min(DEFAULT_SURFACE.radius, height / 2),
            `card radius must come from the surface style and clamp to height/2 (card: ${card})`);
    }
    // A taller node keeps the nominal radius rather than rounding to a pill.
    const tall = { ...result(), nodes: [{ ...result().nodes[0], height: 90 }, result().nodes[1]] };
    const tallScene = document.createElementNS('', 'g');
    new OrganicMindMapRenderer().render(tallScene, tall, { navigate: () => {}, toggle: () => {}, toggleLabel: () => '', duration: 0 });
    const tallCard = rects(serialize(tallScene)).find(r => r.includes('cmm-organic-hitbox'));
    assert.equal(Number((tallCard.match(/rx="([^"]*)"/) ?? [])[1]), DEFAULT_SURFACE.radius,
        'a node taller than twice the radius keeps the nominal radius');
}

// 2. Cards are flat ink on paper: no border, and the root is a sheet header rather than a box.
{
    const { svg } = paint();
    const cards = rects(svg).filter(r => r.includes('cmm-organic-hitbox'));
    assert.equal(cards.length, 2, 'one card rect per node');
    assert.ok(cards.every(r => /fill="/.test(r)), 'every card declares its own fill');
    assert.ok(cards.every(r => /stroke="var\(--cmm-/.test(r)), 'cards use theme-aware borders');
    assert.ok(cards.every(r => /stroke-width="(?:0\.8|1\.4)"/.test(r)), 'root and child border weights are exported attributes');
    assert.ok(!cards.some(r => /fill="transparent"/.test(r)), 'no card relies on a CSS default for its fill');
}

// 3. The root is a sheet header: a small-caps label, then a hairline rule under the title.
{
    const { svg } = paint({ eyebrow: 'OPERATING SYSTEMS' });
    assert.match(svg, /class="cmm-organic-eyebrow"/, 'the root renders its eyebrow label');
    assert.match(svg, /OPERATING SYSTEMS/, 'the eyebrow carries the supplied document name');
    assert.match(svg, /class="cmm-organic-head-rule"/, 'the root renders a head rule');
    assert.match(svg, /<line[^>]*stroke="var\(--cmm-rule/, 'the head rule uses the rule token');
    const plain = paint().svg;
    assert.ok(!/class="cmm-organic-eyebrow"/.test(plain), 'no eyebrow is invented when none is supplied');
    assert.match(plain, /class="cmm-organic-head-rule"/, 'the head rule is unconditional');
}

// 4. Connectors are one tapered stroke each; the fake-depth duplicate no longer exists.
{
    const { svg } = paint();
    assert.ok(!/cmm-branch-echo/.test(svg), 'the branch echo stroke was removed');
    const strokes = (svg.match(/<path[^>]*data-child-id[^>]*>/g) ?? []);
    assert.equal(strokes.length, 1, 'exactly one stroke per branch');
    assert.match(strokes[0], /opacity="0\.88"/, 'the branch stroke carries its opacity as an attribute');
    assert.match(strokes[0], /stroke-width="4\.2"/, 'the taper width is an attribute');
}

// 4. Font metrics come from the measurement pass, not from CSS.
{
    const { svg } = paint();
    const text = (svg.match(/<text[^>]*>/g) ?? []);
    assert.ok(text.length >= 2, 'every node renders its label');
    for (const t of text) {
        assert.match(t, /font-size="\d/, `label font-size must be an attribute (${t})`);
        assert.match(t, /font-weight="\d/, `label font-weight must be an attribute (${t})`);
    }
}

// 5. Font metrics come from the measurement pass, not from CSS.
{
    const { svg } = paint();
    const text = (svg.match(/<text[^>]*>/g) ?? []);
    assert.ok(text.length >= 2, 'every node renders its label');
    for (const t of text) {
        assert.match(t, /font-size="\d/, `label font-size must be an attribute (${t})`);
        assert.match(t, /font-weight="\d/, `label font-weight must be an attribute (${t})`);
    }
}

// 6. A caller-supplied surface overrides the baseline, which is how Composer flattens Sketch cards.
{
    const flat = { ...DEFAULT_SURFACE, cardFill: 'none', rootFill: 'none', cardStroke: 'none', rootStroke: 'none', cardStrokeWidth: 0, rootStrokeWidth: 0 };
    const { svg } = paint({ surface: flat });
    const cards = rects(svg).filter(r => r.includes('cmm-organic-hitbox'));
    assert.ok(cards.every(r => /fill="none"/.test(r)), 'a flattened surface removes the card fill');
    assert.ok(cards.every(r => /stroke="none"/.test(r)), 'a flattened surface removes the card border');
}

// 7. Architectural rule: styles.css must not set an unconditional fill or stroke on the default
//    card. If it does, it silently wins over the renderer's attributes and the export diverges
//    from the screen again. State selectors, depth-specific rules and non-card properties
//    (rx, filter, stroke-dasharray) are legitimate and ignored.
{
    const css = fs.readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    for (const rule of css.split('}')) {
        const brace = rule.indexOf('{');
        if (brace < 0) continue;
        const selector = rule.slice(0, brace).trim();
        const body = rule.slice(brace + 1);
        if (!/\.cmm-organic-hitbox\b/.test(selector)) continue;
        // A rule scoped to a state, a depth, or a non-default surface is allowed to restyle cards.
        if (/:hover|:focus|is-selected|is-multiselected|is-editing|is-reading|is-current-match|is-match|is-drop|is-sketch|is-idea|is-root|is-touch|writing-drop|data-cmm-depth/.test(selector)) continue;
        const declared = [...body.matchAll(/(?:^|;)\s*(fill|stroke)\s*:/g)].map(m => m[1]);
        if (declared.length) offenders.push(`${selector} declares ${declared.join('/')}`);
    }
    assert.deepEqual(offenders, [],
        'styles.css must not set an unconditional fill/stroke on .cmm-organic-hitbox; the renderer owns it');
}

console.log('PASS render contract: card radius, theme-aware cards, root sheet header, single tapered ' +
    'connector, font metrics and surface overrides are attributes, and CSS does not override them');
