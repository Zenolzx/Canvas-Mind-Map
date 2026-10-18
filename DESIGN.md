# Canvas Mind Map — visual specification

**Direction: editorial paper.** Ink on paper, flat cards, one hairline everywhere. The map is a
document you read; only chrome floats. This document is normative: when code and this file
disagree, one of them is a bug.

---

## 1. Principles

1. **Two orthogonal axes.** `palette` (hue) and `surfaceMaterial` (structure) are independent
   settings. Any palette combines with any material. A preset never implies a texture.
2. **The map is flat; only chrome floats.** Cards carry a fill and a hairline, never a shadow.
   Elevation is reserved for floating panels (trays, toolbars, overlays) which never appear in an
   export. This is what makes screen and export identical by construction.
3. **Colour serves navigation, not decoration.** Branch hue lives on the connector only. Text is
   always the darkest ink in the palette. States (selection, search hit, todo, writing progress)
   are the only other colour consumers.
4. **Never force a typeface.** Typography follows the vault by default. A serif display face is an
   explicit opt-in.
5. **One owner per value.** Every colour, radius, size, weight and duration is a token with a
   single declaration site. SVG needs numbers, so `src/design/*.ts` mirrors the token scales that
   presentation attributes cannot read — the two lists must stay in step (asserted by a test).

---

## 2. Axes

### 2.1 Palette (`AppearancePreset`)

| id | name | character |
| --- | --- | --- |
| `obsidian` | Follow Obsidian theme | no override: every token maps to an Obsidian variable. **Default.** |
| `ink` | Mineral ink · Teal | cool mineral teal on pale mint-grey paper |
| `cinnabar` | Warm paper · Cinnabar | warm paper, brick-red accent |
| `breeze` | Mint · Sea glass | very light aqua paper, muted sea-green accent |
| `violet` | Sakura · Dusty rose | pink-white paper, dusty rose accent |

`white` is **removed**: it was "plain white" while `obsidian` already means "no override", so the
picker offered two zero-design options. Migration: `white → obsidian`. Existing `graphite → ink`,
`theme → obsidian`, `wash`/`whale → breeze`, `gold → cinnabar` migrations are kept.

### 2.2 Surface material (`SurfaceMaterial`)

| id | rendering | default |
| --- | --- | --- |
| `none` | flat paper | |
| `dots` | 24 px dot grid | **yes** |
| `grid` | 24 px hairline grid | |
| `paper` | 160 px grain tile | |
| — | custom image (`backgroundImage`, non-empty) | overrides material, exclusive |

Default is `dots`: a fresh install must not look like a flat colour swatch, and a dot grid is the
least opinionated structure that still reads as "a surface".

---

## 3. Tokens

Declared once on `.cmm-organic-view` / `.cmm-composer` / `.cmm-themed-canvas`. Presets override
hue only; materials override `--cmm-texture*` only.

### 3.1 Surface and ink

| token | role |
| --- | --- |
| `--cmm-paper` | the page |
| `--cmm-paper-rgb` | same colour as an `R, G, B` triplet, for alpha compositing |
| `--cmm-paper-raised` | panels, root card, toolbars |
| `--cmm-toolbar` | toolbar/status fill |
| `--cmm-ink` | primary text |
| `--cmm-muted` | secondary text |
| `--cmm-faint` | tertiary text, disabled |
| `--cmm-rule` | every hairline: card border, panel border, divider |
| `--cmm-node-fill` | non-root card fill |
| `--cmm-accent` | selection, focus ring, active control |
| `--cmm-accent-soft` | hover/hovered row wash |
| `--cmm-action` / `--cmm-action-text` | primary button fill and its label |

### 3.2 Texture

| token | role |
| --- | --- |
| `--cmm-texture` | dot/grid ink (an `rgba()` at the calibrated alpha) |
| `--cmm-texture-size` | pitch, `24px` |
| `--cmm-texture-image` | grain tile `url()` |

Recipes (`.cmm-organic-view`, `.cmm-composer`, `.cmm-themed-canvas .canvas-wrapper`):

```css
/* dots */
background-image: radial-gradient(circle at 1px 1px, var(--cmm-texture) 1px, transparent 1.6px);
background-size: var(--cmm-texture-size) var(--cmm-texture-size);

/* grid */
background-image:
    linear-gradient(to right,  var(--cmm-texture) 1px, transparent 1px),
    linear-gradient(to bottom, var(--cmm-texture) 1px, transparent 1px);
background-size: var(--cmm-texture-size) var(--cmm-texture-size);

/* paper */
background-image: var(--cmm-texture-image);
background-size: 160px 160px;
```

Calibration — these alphas are chosen so the structure is legible only once looked for. Any
increase must be justified by a screenshot, not by taste.

| material | light | dark |
| --- | --- | --- |
| dots | `rgba(ink, .055)` | `rgba(ink, .085)` |
| grid | `rgba(ink, .045)` | `rgba(ink, .075)` |
| paper | tile opacity `.035` | tile opacity `.05` |

`--cmm-texture-image` (single 180-byte data URI, no shipped asset):

```
url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E")
```

**The texture is painted by the view container, never by the map `<svg>`.** `.cmm-organic-surface`
and `.cmm-composer-stage` become `background: transparent`. One painting surface, one owner.

**No parallax.** A grid that slides while you pan reads as a bug, and the parallax existed only to
animate a photograph. `src/appearance/AppearanceParallax.ts` and its three call sites are deleted
along with the wallpapers.

### 3.3 Elevation

Only chrome floats. `--cmm-shadow-color` is per-palette and theme-aware (never a hardcoded
`rgba(0,0,0,…)` at a use site).

| token | use |
| --- | --- |
| `--cmm-elev-1` | floating tray (sketch tools), drop preview |
| `--cmm-elev-2` | menus, popovers |
| `--cmm-elev-3` | modals |

Cards use none. The Composer `drop-shadow` filter on `.cmm-organic-hitbox` is **deleted**: it gave
Composer cards an elevation that Organic cards lacked, and it cannot survive an export.

### 3.4 Radius and type

`--cmm-radius-xs 4 / s 6 / m 9 / l 14 / pill 999`, mirrored as `RADIUS` in `src/design/geometry.ts`.

| token | value | use |
| --- | --- | --- |
| `--cmm-font-2xs` | `10px` | eyebrow labels, badges |
| `--cmm-font-xs` | `11px` | meta, secondary status |
| `--cmm-font-s` | `12px` | status lines, hints, captions |
| `--cmm-font-m` | `13px` | controls, inputs, inbox |
| `--cmm-font-l` | `15px` | document body |
| `--cmm-font-xl` | `18px` | panel headings |
| `--cmm-track-wide` | `.12em` | eyebrow labels only |
| `--cmm-track-tight` | `-.01em` | display sizes only |
| `--cmm-font-display` | `var(--font-text)` | card and heading face |

`src/design/type.ts` is the single source of the SVG ladder and weights:

```ts
export const TYPE_SCALE = [30, 21, 17, 15, 14, 13, 12] as const;  // by depth
export const WEIGHT = { display: 650, strong: 500, body: 400 } as const;
```

HTML rules may no longer declare a raw `font-size:` in `px`; they use `--cmm-font-*`. This is
enforced by `scripts/verify-design-tokens.cjs`.

`typography: 'match' | 'serif'` (default `match`): `serif` sets
`--cmm-font-display: Georgia, 'Songti SC', 'Noto Serif CJK SC', serif`.

---

## 4. Components

### 4.1 Card

| property | value |
| --- | --- |
| fill | `--cmm-node-fill`; opaque when a custom image is active |
| stroke | none (borderless) |
| radius | `min(RADIUS.m, height / 2)` |
| label | `--cmm-ink`, `--cmm-font-display`, depth ladder × `fontScale` |
| line height | `1.4`; first baseline at `+fontSize × 1.08` |
| padding | horizontal `14px`, vertical derived from line count |

Borderless is deliberate: at hairline weight a border on every card produced a graph-paper effect
that fought the background structure. Cards are separated by fill contrast and whitespace.

Selected / hover / match states keep the existing ring treatment (`--cmm-accent`, `1.6px`),
`--cmm-accent-soft` hover wash, `--text-highlight-bg` for search hits.

### 4.2 Root node — sheet header

| property | value |
| --- | --- |
| fill | none |
| stroke | none |
| eyebrow | `--cmm-font-2xs`, `--cmm-track-wide`, `--cmm-muted`, uppercased source name |
| title | depth-0 size × `1.15`, `WEIGHT.display`, `--cmm-track-tight`, `--cmm-ink` |
| rule | `1px` `--cmm-rule`, full card width, `6px` below the last baseline |

The eyebrow is rendered by `OrganicMindMapRenderer` as a `<text>` attribute set (not CSS) so the
export contains it. Layout reserves `14px` extra height for depth 0 only.

### 4.3 Connector

Single cubic Bézier, `stroke-linecap/join: round`, width
`max(1.15, branchWidth × branchDecay^(depth − 1))` with `branchWidth 4.2`, `decay 0.72`
(Composer `1.8`). Colour is the branch hue at `opacity .88`.

**The echo stroke (`cmm-branch-echo`) is deleted.** It was a translucent duplicate offset by
`(0.7, 1.2)` to fake depth; tapering expresses the same hierarchy honestly, costs one path instead
of two, and removes the only place an export had to replicate a CSS-only effect.

### 4.4 Branch hue

`BranchColourMode = 'palette' | 'monochrome'` (default `palette`). Palette mode assigns a
desaturated hue per top-level branch, applied to the connector **only**; node labels stay
`--cmm-ink` regardless of mode.

Two sets, selected by `.theme-dark`, because one hue cannot be legible on both papers:

```ts
export const BRANCH_PALETTE_LIGHT = [
    '#5f8c86', '#a97648', '#91637a', '#6b7d52', '#66759f', '#a2665b', '#7d6796', '#5a7f8d',
] as const;
export const BRANCH_PALETTE_DARK = [
    '#7fb3a8', '#c79a6a', '#b98ba3', '#8fa877', '#8f9fd1', '#c4887c', '#a58cbe', '#7fb0b8',
] as const;
```

`SKETCH_PALETTE` and `SKETCH_NOTE_PAPERS` keep their role (hand-drawn strokes, free-note paper).

### 4.5 Panels, toolbars, chrome

Opaque `--cmm-paper-raised`, one hairline on the edge facing the map, `--cmm-elev-1` only for
floating trays. **No `backdrop-filter` anywhere.** The glass treatment only made sense over a
photograph; over a dot grid it is an empty GPU cost.

### 4.6 Sketch

Unchanged in language (hand-drawn outline, wobble seeded per `kind:index`) but re-tinted from the
new palettes and the four hardcoded hex values (`#e4c967`, `#baa45b`, `#c78478`, `#72958b`) move
to tokens `--cmm-highlight-mark`, `--cmm-highlight-mark-dark`, `--cmm-sketch-ellipse`,
`--cmm-sketch-branch`.

---

## 5. Custom background image

- `backgroundImage: string` — a vault-relative path, empty by default. Resolved at paint time via
  `app.vault.adapter.getResourcePath()`. Nothing is copied, embedded, or base64-encoded.
- `backgroundImageStrength: 0–100` (default `35`) — an overlay layer
  `linear-gradient(rgba(var(--cmm-paper-rgb), s), rgba(var(--cmm-paper-rgb), s))` above the image,
  so contrast is recoverable without editing the image.
- Exclusive with `surfaceMaterial`: a non-empty image forces no texture.
- When an image is active, `--cmm-node-fill` becomes opaque (`--cmm-paper-raised` at full alpha).
  No glass on cards.

---

## 6. Dark mode

Every palette has explicit dark tokens (this closes the `white` preset's missing dark block by
deleting that preset). Rules:

- paper darkens, ink lightens, `--cmm-rule` is a light `rgba` on dark paper, accent desaturates.
- `--cmm-shadow-color` becomes `rgba(0,0,0,…)`; no shadow colour is written at a use site.
- texture alpha **increases** on dark (a light-on-dark structure needs more alpha to read).
- the map is never stripped of its material on dark. There is no dark-mode special case for
  backgrounds any more.

---

## 7. Deletions

| removed | reason |
| --- | --- |
| `assets/{ink-landscape,cinnabar-landscape,mint-leaves,sakura-lake}.webp` | photographs are the wrong language for a reading surface; no dark variants exist, so they were silently stripped on dark themes; 352,708 chars = 32.5 % of `main.js` sat in an inline `style` attribute |
| `.webp` `dataurl` loader + `assets.d.ts` | follows from the above |
| `src/appearance/AppearanceParallax.ts` + 3 call sites | existed only to animate a photograph |
| `--cmm-art` | the delivery mechanism for the photographs |
| `white` preset | duplicate zero-design option; `obsidian` already means "no override" |
| `cmm-branch-echo` | fake depth, replaced by tapering |
| `.cmm-organic-hitbox` `drop-shadow` (Composer only) | cards are flat; asymmetric elevation |
| `backdrop-filter` (6 rules) | glass over a grid is cost without meaning |
| `--cmm-control-size` | declared, referenced zero times |
| `.cmm-composer-toolbar strong` | no such element is ever created |
| 7 duplicate rule pairs | later definitions already win |
| hardcoded `'#45423f'` / `'#8c887d'` in `OrganicLayoutEngine` | bypassed the token system |
| hardcoded `rx: 9` in `OrganicExportService` | exported a radius the screen did not use |

---

## 8. Settings surface

```
Mind map appearance
  Style preset            obsidian | ink | cinnabar | breeze | violet
  Surface material        none | dots | grid | paper        (default dots)
  Branch colours          palette | monochrome
  Typography              match vault | serif
  Background image        vault path (empty = none)
  Background strength     0–100                             (visible only with an image)
```

`surfaceMaterial` and `backgroundImage` are independent of the preset, so switching hue never
loses the structure choice.

---

## 9. Verification

The appearance system is guarded at four levels; a change that breaks any level fails `npm test`.

1. **`scripts/verify-design-tokens.cjs`** (new) — no raw colour literal outside the palette
   declaration block; no `font-size: <n>px` in component rules; every palette declares the full
   token set in both modes; `RADIUS`/`TYPE_SCALE` mirror their CSS counterparts.
2. **`scripts/verify-render-contract.cjs`** (extended) — card fill/stroke/radius, connector width
   taper and `opacity .88`, **absence** of `cmm-branch-echo`, root eyebrow + rule, and that
   `styles.css` never re-declares a value the renderer owns.
3. **`scripts/verify-organic-export.cjs`** (extended) — export radius equals the surface radius,
   export contains the root rule and eyebrow, export carries no filter or backdrop effect.
4. **Screenshot baselines** — re-recorded for 3 materials × 2 themes on one palette, plus the
   existing gesture-driven captures at their documented tolerances.

Plus a hard size gate: `main.js` must stay under **760 KB**. It is 1,084,706 B today and the
wallpaper payload is 352,708 B of it. A material made of CSS gradients and an 180-byte SVG tile
cannot regress that.

---

## 10. Viewport behaviour (paired fix)

Independent of appearance, but specified here because it is the same class of defect — a value
with no single owner.

Contract for any edit that adds, removes, or renames a node:

1. **The node being edited does not move on screen.** It is the anchor; its screen point is
   invariant across the edit.
2. **The map does not move** unless the newly created node would land outside the visible area.
3. When it would, the map pans **the minimum distance** that brings it inside a 24 px margin.
4. **No movement may be computed from an unmeasured pane.** If the pane reports `0` width or
   height, the operation is a no-op. (Today `ensureVisible()` reads `this.svg.clientWidth`
   unguarded; at `0` the margin expression inverts and the pan becomes `-24 − x − width`, which
   throws the entire map off screen.)
5. The pan is exactly the minimum distance that clears the margin, and a non-finite delta aborts
   the operation. It is **not** capped at a card's extent: a node far off screen needs a
   correspondingly large pan, and capping it would leave that node permanently unreachable.
