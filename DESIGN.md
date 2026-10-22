# Canvas Mind Map — workspace design

This is the current design specification. It replaces the former flat editorial-paper direction.

## Product direction

A visual thinking workspace with three continuous activities: structure thoughts, write their
direct bodies, and explore on a free canvas. The content is the visual centre. Material,
hierarchy and predictable controls give the workspace its identity.

Primary references: [Heptabase's workspace structure](https://wiki.heptabase.com/user-interface-logic),
[Milanote's visual project boards](https://milanote.com/),
[Craft's page styling](https://support.craft.do/hc/en-us/articles/10293992410780-Document-Styling),
[Xmind's complete themes](https://xmind.com/user-guide/custom-themes-new), and
[FigJam's creation tools](https://help.figma.com/hc/en-us/articles/1500004362321-Guide-to-FigJam).
These inform the design; no external UI or artwork is copied into the plugin.

## Workspace structure

- Header: document name and save status at left, three explicit mode tabs in the centre,
  search/view/appearance/document actions at right. Save feedback is a live status region.
- Left: 260px ideas inbox, with a dedicated capture field, search and draggable idea cards.
- Centre: flexible map occupying all remaining pane height. Creation dock at bottom centre,
  scale/reset/fit controls at bottom right. The inbox entry remains at top left.
- Right: direct section body, limited to 440px and 55% of the pane, with a minimum of 280px.
  Breadcrumbs and pin/close actions precede the editor. The existing resize handle remains.
- Empty state: one root, a concise introduction, create-section/template actions and shortcut hints.
- Organic document views share the same theme, node renderer, reading/editor materials and appearance picker.
- Native Canvas retains its own interaction model and manually chosen node/edge colours.

The composer responds to **its own pane width**, using container queries rather than the app
window width. Under 720px, inbox and body become overlays; under 900px, opening one closes the
other. The mode tabs remain accessible above the drawers. Resizing a pane preserves the selected
node's screen position, with only the minimum necessary visibility adjustment.

## Themes and material

New installations use Mineral paper with paper grain. Existing saved theme/material preferences
are retained. Legacy palette migrations remain valid.

| ID | Theme | Direction |
|---|---|---|
| ink | Mineral paper | warm mineral grey, deep green ink, teal action |
| slate | Midnight graphite | independent dark slate, soft light ink, pale green action |
| breeze | Forest mist | sage paper, forest ink, green accents |
| cinnabar | Terracotta | warm ivory with earthen red |
| violet | Muted lavender | light rose/lavender with plum accents |
| obsidian | Follow Obsidian | retain the active vault's colours |

Every named theme has a complete token set. Slate stays dark in a light host; the other themes
also have explicit dark-host variants. The branch palette has independent light/dark values.

The material stack contains a quiet colour field, peripheral contour lines and either paper grain,
dots or grid. The centre stays clear. Plain disables the decorative material. A vault background
image remains available through settings and replaces the procedural material, with adjustable
paper overlay strength. Materials are static and do not cause parallax or movement during edits.

Appearance is selected through previews of small complete diagrams. Changes preview in the
invoking pane; Cancel or Escape restores its settings. Apply saves the palette/material and updates
the other panes. Failed saves keep the chooser open and display a recoverable error.

## Nodes and hierarchy

Root, first-level topic and deeper topic are distinct. The root has a stronger theme-accent border,
large title and soft tint; first-level topics have a branch-coloured mark and subtle wash; deeper
topics use a raised-paper fill and a fine boundary. Text always uses the theme's foreground ink.
Branch colours are stable across edits, with one tapered curve per connection.

The shared type ladder is `[30, 21, 17, 15, 14, 13, 12]`, with the normal composer using 1x metrics
and compact mode using .88x. Layout measurement and SVG paint use the same typeface. The shared
radius ladder remains 4 / 6 / 9 / 14px. Selection, hover, search and drag targets have separate
states. Low zoom hides secondary creation/status marks.

SVG presentation attributes own baseline node fills, strokes, radii, type and branch marks.
CSS owns interaction states and workspace chrome. Export uses the same renderer and resolves
theme variables to concrete colours. Plain exports and optional themed-paper SVG/PNG exports
are separate menu choices. The portable themed-paper export is procedural; it does not embed
the user's custom photo background.

## Implementation ownership

- `styles.css`: shared scales, palette tables, materials, component states, one workspace shell
  block with its container rules, and appearance-gallery presentation.
- `src/appearance/AppearancePicker.ts`: scoped preview and apply/cancel lifecycle.
- `src/composer/ComposerView.ts`: explicit modes, drawer coordination, controls and viewport anchoring.
- `src/organic/OrganicMindMapRenderer.ts`: shared baseline node/branch presentation.
- `src/organic/OrganicExportService.ts`: portable exports and procedural export material.
- `src/design/*`: shared numeric geometry/type/branch values.

Use host icons and fonts. Avoid adding a separate navigation rail inside Obsidian. Keep a single
source for each token and replace obsolete rules when changing component ownership. No embedded
raster wallpaper payload or full-pane blur is required for the default design.

## Verification

`npm run build`, `npm run test:unit`, `npm run test:composer-browser`, and
`npm run test:writing-browser` cover source correctness and existing workflows.
`node scripts/run-workspace-design-browser.cjs` checks the theme chooser, Chinese content,
1440/1024/720/480px panes, narrow panes inside wide windows and mutual drawer exclusion.

Review the generated screenshots at normal size, including empty, populated, writing, light,
dark and narrow states. Record deliberate baseline changes only after reviewing them. A real
Obsidian run is also required because fixture chrome cannot substitute for the host's styles.
