# Rendering modes and migration

Both rendering paths consume `src/core/MindMapModel.ts`, built by the single
`src/core/HeadingParser.ts`. The parser retains ATX/Setext behavior, exclusion of
YAML and code, existing hierarchy keys, original heading level, and zero-based
source start/end lines (end exclusive). The model adds renderer-neutral IDs,
parent/children and a document root. Heading level and structural depth differ
when a document skips heading levels. Keys are deterministic within a document;
they are not durable identifiers across renames or ambiguous duplicate edits.

```text
Markdown → HeadingParser → MindMapModel
                             ├─ NativeCanvasRenderer → native Canvas cards
                             │    + NativeCanvasModel layouts / metadata
                             │    + CanvasMindmap lifecycle / transactions
                             └─ OrganicLayoutEngine → OrganicLayoutResult
                                                        ↓
                                               OrganicMindMapRenderer
```

## Native compatibility boundary

`src/native/NativeCanvasRenderer.ts` adapts the shared model into real Canvas
cards. It receives native ID generation, styles and file/text payload creation
from `CanvasMindmap`. Generation and refresh both use this adapter.

`src/native/NativeCanvasModel.ts` retains native metadata, folding, style overrides
and focus projection. It adapts visible card bounds to `NativeLayoutEngine`, a
pure geometry module for all seven layouts. `src/MindmapModel.ts` is a legacy
re-export so existing imports keep working. `CanvasMindmap` remains responsible
for source retrieval, compacting the physical center, external edge reconnection,
manual edit preservation, native saving, selection, history and lifecycle patches.
The temporary document-root model used before native center compaction preserves
the previous generation sequence. Already compacted roots use model promotion.

The `canvasMindMap` metadata version remains 1. Existing `lastMode` remains the
Native title/body choice, not a rendering-mode switch. No Canvas-file conversion,
automatic migration is performed when opening an existing Canvas.

New maps use branch colors and lightweight heading cards. Old maps opt in through
the branch appearance command. `NativeAppearance` persists first-branch palette
identity, propagates it to descendants and native edges, and preserves manual
node size/color and edge color overrides. Body cards retain their content styling.
The initial layout preference is horizontal; saved preferences remain respected.

The native engine packs complete measured subtrees, uses progressively shorter
base gaps, and assigns radial sectors by complete-tree weights. Full relayout
replaces manual positions. Local expansion fixes the clicked node and ancestor
path and repacks descendants, leaving other first-level branches and external
cards in place. Collision handling translates whole child subtrees outward using
analytical rectangle-sweep intervals, allowing longer connections where needed.
Global cross-axis lanes may overlap after a local edit; this is necessary when
neighbouring branches must stay fixed. Native edge control points remain owned
by Obsidian. Layout geometry is independent of DOM rendering and source parsing.

## Organic boundary

`OrganicMindMapView` owns source snapshots, session folding, viewport transforms,
source navigation and refresh. It supplies measured text widths to the pure engine.
The renderer does not read source files, compute positions or mutate the model.
SVG text uses the same font family/size/weight used for measurement. Heading text
is assigned with `textContent`, never inserted as HTML.

`OrganicLayoutEngine` allocates angular sectors using complete-tree leaf weights,
keeping first-level side/color/order stable through folding. It proposes depth-based
branch lengths and directions, then packs whole visible subtrees by their measured
extents. This prevents the sequential-node collision fixes from pushing connections
through sibling labels. Packing can lengthen a branch vertically when necessary;
readability takes precedence over strict branch-length reduction. No random jitter
or global grid is used. Bézier geometry is computed only after positions settle.

Folding keeps the clicked heading's screen position using a viewport offset
adjustment. Descendant expansion choices survive collapsing their ancestors.
Refresh retains matching session fold IDs, discards obsolete IDs and preserves
the viewport. Source reads use revision guards to discard stale/closed-view loads.
Navigation requires the source snapshot still to match, then opens the exact line
in a reusable source pane. No source edits or extra map files are made.

## Verification

- `npm test`: existing Native layout/focus regressions; shared parsing, native
  adaptation, Organic layout and controller boundary tests.
- `npm run build`: TypeScript check and production bundle.
- `npm run preview:organic`: generates a standalone SVG-renderer preview under
  `tmp/organic-preview/` from a bilingual, uneven document fixture.
- `scripts/render-organic-preview.py`: optional Pillow geometry image from that
  result. It is a static layout check, not an Obsidian screenshot.
- `node scripts/verify-native-appearance.cjs --preview` followed by
  `python scripts/render-native-preview.py`: optional Pillow contact sheet of all
  seven native layouts under `tmp/native-preview/`. Connectors are approximated
  for geometry inspection; this does not validate the host's SVG or CSS rendering.

Runtime acceptance in Obsidian should include opening Organic from a note, folding
with keyboard and mouse, zoom/pan, repeated-title navigation, refresh after edits,
and closing/reopening. Native acceptance should include old Canvas loading,
generation in both content modes, manual movement, seven layouts, focus, refresh,
and undo/redo. The automated boundary stubs do not certify host behavior.
