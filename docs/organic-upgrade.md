# Organic browser upgrade

## Architecture and delivery phases

The shared HeadingParser and MindMapModel remain the document boundary. Organic
has its own identity, view-state and rendering pipeline; Native retains its Canvas
metadata, transactions, undo/redo and seven layouts. The minimum Obsidian version
remains 1.7.7. Existing Canvas files are not migrated or relaid out on load.

| Phase | Files / responsibilities | Validation |
| --- | --- | --- |
| 1 | PluginDataStore, OrganicStateStore, OrganicViewState, OrganicViewportController, main/settings/View integration | TypeScript + existing tests + serialization/reopen/reset tests |
| 2 | OrganicNodeIdentity, OrganicAutoRefreshController, source reconciliation in View | TypeScript + all tests + rename/duplicate/debounce/close cases |
| 3 | OrganicSearchController, OrganicInteractionController, OrganicToolbar, renderer highlight styles, commands | TypeScript + all tests + search/Focus/Reading policy tests |
| 4 | OrganicLayoutEngine options and three strategies, stable branch styles in state | TypeScript + all tests + 50/200/500 headings in all three layouts |
| 5 | OrganicAnimationController, renderer delegation/group reuse, smooth viewport follow | TypeScript + all tests; browser rapid cancellation at 50/200/500 nodes |
| 6 | OrganicExportService, export toolbar/settings integration | TypeScript + all tests; browser SVG parse and PNG decode/dimensions |
| 7 | CanvasMindmap.addMenu, extracted restore-template action and command | TypeScript + all Native/Organic tests; menu grouping/actions/readonly/fallback test |
| 8 | File/folder state lifecycle, ownership, layout cache, rAF pan, settings/language, docs and browser harness | Full tests, browser View flows and production build |

## Interaction contract

- Focus displays the selected subtree and ancestor path. It does not edit the model.
- Reading retains a branch root and a current heading, moving in Markdown order.
- Search is case-insensitive heading substring matching, including folded headings.
- A result outside Focus temporarily suspends Focus. Clearing search restores it.
- Search and Reading temporarily expand ancestors without altering durable folding.
- Manual collapse clears a search result hidden by that collapse, and moves reading
  back to the collapsed heading (or exits Reading when collapsing its ancestor).
- Esc exits search, then Reading, then Focus, then selection. Input fields retain
  their normal keys; the search field handles its own Enter/Shift+Enter/Esc.
- View state is per file. Tabs remain independent; the most recent actual user
  interaction owns persistence. Closing an idle tab does not submit an old snapshot.
- Automatic refresh reads Markdown only. A changed heading tree triggers layout;
  body-only changes update source mappings without a layout pass.

## Identity and migration

Plugin data retains existing top-level settings keys and adds `organic` settings
and `organicState.version = 1`. File entries include a document fingerprint,
compact identity descriptors, collapsed IDs, map-coordinate viewport center/zoom,
focus, reading root/current ID, selection, layout and branch colors/sides.

Organic identity is separate from the parser's deterministic path key. Matching
requires structural or section-content evidence. Matched parents anchor uniquely
named descendants through a parent rename. Ambiguous siblings with identical names
and content are deliberately not guessed. Renaming a heading with no distinguishing
content may therefore lose its state; deleting or replacing a branch clears any
unmatched focus/reading/selection. This is preferable to attaching state incorrectly.

Malformed entries are ignored and missing settings receive defaults. Unsupported
state versions do not restore. File and folder renames migrate keys; deletion and
explicit reset remove saved entries. Writes debounce by 750ms and serialize with
settings saves. Normal close flushes pending writes; forced process termination
before a save completes cannot guarantee the last interaction is retained.

## Export

Exports reflect the current visible projection, including Focus, folding, branch
colors and typography. SVG carries its own viewBox, padding, explicit colors and
font fallback, with no embedded local fonts. PNG renders that SVG at 1x, 2x or 3x
(default 2x), with the current background. Filenames are `<note>-mind-map.svg/png`,
with numeric suffixes on conflicts. Output is saved next to the note.

The rasterizer refuses dimensions above 32767 on either axis or 128 million pixels.
Very large/long-heading maps should use SVG, lower scale or a collapsed projection.
Font glyph appearance can differ when an SVG is opened on a system with other fonts.

## Verification and limits

`npm test` runs Native layout/focus/appearance, Native menu, Organic parser/layout,
View boundary, persistence/identity/interaction, and scale tests. All three Organic
layouts are checked for rectangle overlaps and curve-bound containment at 50, 200
and 500 headings. Existing branch/text-intersection regressions remain in place.

The real-browser harness additionally verifies SVG XML parsing, Chinese/emoji text,
PNG decoding and exact output dimensions, delegated events, rapid animation cleanup,
and production View flows with a simulated Obsidian vault/workspace. One measured
run on this machine produced:

| Headings | Compact layout + DOM render | PNG at 2x |
| --- | --- | --- |
| 50 | 3.9 ms | 3773 × 1937 |
| 200 | 9.5 ms | 3879 × 6337 |
| 500 | 25.6 ms | 3881 × 16062 |

These are fixture measurements, not performance guarantees. Font measurement,
heading length, device and layout affect results. The harness does not certify
Obsidian's native Canvas internals, actual app restart timing or every custom theme.
The plugin has not been installed into a user vault as part of this change.
