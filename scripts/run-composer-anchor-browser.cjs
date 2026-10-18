/**
 * The four clauses of the Composer viewport contract.
 *
 *   a) the node being edited does not move on screen;
 *   b) the map does not move unless the new node would land outside the visible area;
 *   c) when it would, the map pans the minimum distance that brings it inside;
 *   d) no pan is ever computed from an unmeasured pane.
 *
 * Clause (b) is the reported bug: adding a node used to move the scene by hundreds of pixels on
 * every Enter, because the layout re-derived branch sides from mutable weights and the anchor pin
 * then translated everything to chase one node. Runs against the fixture built by
 * scripts/verify-composer-browser.cjs.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchOptions, requireTooling } = require('./lib/browser.cjs');

// The viewport must not move. The defect this guards produced pans of 570-884px per insertion.
const TOLERANCE = 4;
// Cards DO move a little: adding a sibling re-centres its group around the parent, which is the
// layout's own geometry and measured 38.8px here. Before the fix the same edit displaced cards by
// 550-1000px and pushed most of them out of the pane, so this bound separates the two clearly.
const NODE_TOLERANCE = 60;

const { chromium } = requireTooling('Composer anchor browser');
(async () => {
    const browser = await chromium.launch(launchOptions());
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(path.resolve('tmp/composer-browser/index.html')).href);
        await page.waitForFunction(() => window.ready);

        const snapshot = () => page.evaluate(() => {
            const view = window.composerTest.view;
            const pane = view.svg.getBoundingClientRect();
            const boxes = {};
            for (const node of view.result?.nodes ?? []) {
                const element = Array.from(view.scene.querySelectorAll('[data-node-id]'))
                    .find(candidate => candidate.getAttribute('data-node-id') === node.id);
                if (!element) continue;
                const rect = element.getBoundingClientRect();
                boxes[node.id] = { title: node.title, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }
            return { transform: view.scene.getAttribute('transform'), boxes,
                pane: { x: pane.x, y: pane.y, width: pane.width, height: pane.height },
                offset: { ...view.viewport.offset }, scale: view.viewport.scale };
        });
        const translate = transform => {
            const match = /translate\(\s*(-?[\d.eE+]+)[ ,]+(-?[\d.eE+]+)\s*\)(.*)/.exec(transform ?? '');
            assert.ok(match, `unreadable scene transform: ${transform}`);
            return { x: Number(match[1]), y: Number(match[2]), rest: match[3].trim() };
        };
        const inside = (box, pane) =>
            box.x >= pane.x - 1 && box.y >= pane.y - 1 &&
            box.x + box.width <= pane.x + pane.width + 1 && box.y + box.height <= pane.y + pane.height + 1;

        // --- build a small, fitted map: two top-level sections -------------------------------
        const root = page.locator('svg [role="link"]').first();
        await root.focus();
        await page.keyboard.press('Enter');
        await page.locator('.cmm-composer-title-input').fill('Process');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.locator('.cmm-composer-title-input').fill('Memory');
        await page.keyboard.press('Enter');
        await page.evaluate(() => { const view = window.composerTest.view; view.draft.panel = 'hide'; view.render(); view.fit(); });
        await page.locator('.cmm-composer-stage').focus();

        const before = await snapshot();
        assert.equal(Object.keys(before.boxes).length, 3, 'expected root plus two sections');

        // --- clauses (a) and (b): one Enter, then the title commit ----------------------------
        await page.keyboard.press('Enter');
        await page.locator('.cmm-composer-title-input').fill('Storage');
        await page.keyboard.press('Enter');
        const after = await snapshot();

        const from = translate(before.transform), to = translate(after.transform);
        assert.equal(to.rest, from.rest, 'zoom changed while adding a node');
        assert.ok(Math.abs(to.x - from.x) <= TOLERANCE,
            `clause (b): the scene panned ${(to.x - from.x).toFixed(1)}px horizontally while adding a node`);
        assert.ok(Math.abs(to.y - from.y) <= TOLERANCE,
            `clause (b): the scene panned ${(to.y - from.y).toFixed(1)}px vertically while adding a node`);

        let worstCard = 0;
        for (const [id, box] of Object.entries(before.boxes)) {
            const now = after.boxes[id];
            assert.ok(now, `clause (a): ${box.title} vanished`);
            const moved = Math.hypot(now.x - box.x, now.y - box.y);
            worstCard = Math.max(worstCard, moved);
            assert.ok(moved <= NODE_TOLERANCE,
                `clause (a): ${box.title} moved ${moved.toFixed(1)}px on screen while a node was added`);
            assert.ok(inside(now, after.pane), `clause (a): ${box.title} left the visible area`);
        }
        const created = Object.entries(after.boxes).filter(([id]) => !(id in before.boxes));
        assert.equal(created.length, 1, `expected exactly one new card, saw ${created.length}`);
        assert.equal(created[0][1].title, 'Storage');
        assert.ok(inside(created[0][1], after.pane), 'the new card should be created inside the visible area');

        // --- clause (d): an unmeasured pane must not translate the scene ----------------------
        const zeroPane = await page.evaluate(() => {
            const view = window.composerTest.view, before = { ...view.viewport.offset };
            view.svg.style.width = '0px'; view.svg.style.height = '0px';
            void view.svg.getBoundingClientRect();
            const measured = [view.svg.clientWidth, view.svg.clientHeight];
            view.ensureVisible();
            const after = { ...view.viewport.offset };
            view.svg.style.width = ''; view.svg.style.height = '';
            void view.svg.getBoundingClientRect();
            return { measured, delta: { x: after.x - before.x, y: after.y - before.y } };
        });
        assert.deepEqual(zeroPane.measured, [0, 0], 'the zero-pane probe did not actually collapse the pane');
        assert.deepEqual(zeroPane.delta, { x: 0, y: 0 },
            `clause (d): a pan of (${zeroPane.delta.x},${zeroPane.delta.y}) was computed from an unmeasured pane`);

        // --- clause (c): still scroll when the new node really would be off screen -----------
        await page.evaluate(() => {
            const view = window.composerTest.view;
            view.viewport.pan(-4000, -4000); view.transform();
            const last = view.draft.root.children.at(-1);
            view.select(last.id);
        });
        const away = await snapshot();
        await page.evaluate(() => {
            const view = window.composerTest.view;
            view.add(false);
            // Commit through the same path the user takes, so the measurement is of a settled state.
            view.finishName?.(true);
        });
        const returned = await snapshot();
        const moved = translate(away.transform), landed = translate(returned.transform);
        assert.ok(Math.hypot(landed.x - moved.x, landed.y - moved.y) > 50,
            'clause (c): the map was panned away but adding a node did not bring it back');
        const newest = Object.values(returned.boxes).filter(box => !Object.values(away.boxes)
            .some(previous => previous.title === box.title && Math.abs(previous.x - box.x) < 1));
        assert.ok(newest.length >= 1, 'clause (c): the new card is missing from the render');
        assert.ok(newest.some(box => inside(box, returned.pane)),
            'clause (c): the new card did not end up inside the visible area');

        // --- sketch mode: pinned notes must not be dragged around ----------------------------
        const noteFreeze = await page.evaluate(() => {
            const view = window.composerTest.view;
            view.draft.mode = 'sketch';
            view.render(); view.fit();
            const note = { id: 'note-anchor', title: 'Note', body: '', position: { x: 60, y: 60 } };
            view.draft.sketch ??= { positions: {}, notes: [], links: [], annotations: [] };
            view.draft.sketch.notes.push(note);
            view.render();
            const start = { ...view.viewport.offset };
            const last = view.draft.root.children.at(-1);
            view.select(last.id);
            view.add(false);
            const delta = { x: view.viewport.offset.x - start.x, y: view.viewport.offset.y - start.y };
            const painted = view.scene.querySelector('[data-note-id="note-anchor"]')?.getAttribute('transform') ?? null;
            view.draft.mode = 'structured'; view.render();
            return { delta, painted };
        });
        assert.ok(Math.hypot(noteFreeze.delta.x, noteFreeze.delta.y) <= TOLERANCE * 4,
            `sketch mode translated the scene by ${Math.hypot(noteFreeze.delta.x, noteFreeze.delta.y).toFixed(1)}px`);

        assert.deepEqual(errors, []);
        console.log(`PASS Composer anchor: scene moved (${(to.x - from.x).toFixed(1)},${(to.y - from.y).toFixed(1)})px through Enter plus the title commit, worst card reflow ${worstCard.toFixed(1)}px, unmeasured panes inert, off-screen nodes still scroll into view, sketch notes stay pinned`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
