<div align="right">

[简体中文](README.zh-CN.md) | **English**

</div>

# Canvas Mind Map

**Explore, organize, and edit Markdown notes through mind maps.**

Canvas Mind Map offers two independent rendering modes: Native Canvas for native card editing, and Organic Mind Map for reading and editing Markdown through text and curved, colored branches.

Available in the **Obsidian Community Plugins directory**. [Open the plugin page](https://obsidian.md/plugins?id=canvas-mind-map) · [Download releases](https://github.com/Zenolzx/Canvas-Mind-Map/releases).

This README describes the current source, including Edit / Mind Map Writing. Features available in a packaged version are listed in its [release notes](https://github.com/Zenolzx/Canvas-Mind-Map/releases).

## Rendering modes

| Mode | Purpose | Entry point |
| --- | --- | --- |
| Native Canvas | Real nodes and edges, seven layouts, manual movement and existing Canvas interaction | Generate a mind map from a Canvas source card |
| Organic Mind Map | Read heading structure, search and export; switch to **Edit** to write headings and section bodies directly to Markdown | Right-click a Markdown file or run **Open note in Organic mode** |

For writing, start with [Edit / Mind Map Writing](#edit--mind-map-writing). For movable Canvas cards, follow [Native Canvas Quick Start](#native-canvas-quick-start).

### Organic reading and navigation

Organic opens in its own tab and never converts or overwrites a `.canvas` file. In View mode, a sole top-level heading becomes the center; otherwise the note name is used. Notes without headings show the note name. Initially the center (depth 0) and two descendant levels are visible. Click a heading to open its source line, including repeated headings; use the small +/− controls to fold branches. Folding preserves branch color, side, order and the clicked heading's screen position.

Drag the background to pan, scroll to zoom around the pointer, or use the toolbar's zoom and **Fit to view** controls. With the background focused, arrow keys pan, +/− zoom and 0 fits the map. Headings and fold controls are keyboard accessible.

Organic automatically refreshes after source changes (500ms debounce), preserving matched heading state and the viewport. **Refresh** remains available. Heading identity is reconciled using section content and hierarchy; ambiguous edits safely discard unmatched state. Source navigation still checks for stale content before jumping.

Use **Search headings** or Ctrl/Cmd+F inside Organic to search all headings, including folded descendants. Enter/Shift+Enter moves between results; Esc clears search. Right-click a heading to **Focus branch** or **Read this branch**. Focus shows its subtree and ancestor path; Reading follows Markdown order with ↑/↓ and smooth viewport movement. Search outside a focused branch temporarily suspends Focus and restores it when cleared. Temporary expansion does not overwrite manual folding.

The layout selector offers **Organic Radial**, **Organic Horizontal**, and **Compact Organic**. Fold animations respect reduced motion. **Export → SVG / PNG** saves the current visible structure (including Focus and folding) next to the source note, with numbered filenames to avoid overwriting. PNG defaults to 2x; 1x/2x/3x are available in settings. Very large PNG dimensions are rejected with a suggestion to reduce scale or use SVG.

Folding, zoom, viewport center, Focus, Reading position, selection and layout are stored in plugin data by source path. Rename/move migrates saved state; deletion removes it. Multiple tabs interact independently; the most recent user interaction owns the saved state. Settings provide automatic refresh, remembered state/reset, default layout, animation/duration and PNG scale. **View** explores the note; **Edit** writes changes to the source Markdown and provides its own editing history.

## Edit / Mind Map Writing

1. Right-click a Markdown note and choose **Open note in Organic mode**, or run that command with a note open.
2. Choose **Edit** at the top of the Organic view.
3. Click a heading to select its section. Double-click it or press **F2** to rename it; use **Enter** to add a sibling and **Tab** to add a child.
4. Write in the right-hand editor. It edits the selected heading's **direct body**, excluding child sections, and saves automatically to the same `.md` file.
5. Switch back to **View** to browse the map and jump to the source note.

Drag a heading to move its entire section, including its body and descendants. Drop targets offer **Before / Make child / After** with a preview. You can also promote, demote, or reorder sections with the keyboard. Operations that create cycles or exceed H6 are rejected. Deletion asks whether to remove the entire subtree or keep its body and promote its children.

### Editing shortcuts

These shortcuts apply while the **map has focus**:

| Key | Action |
| --- | --- |
| Double-click / F2 | Rename a heading inline |
| Enter / Tab | Add a sibling / child section |
| Shift+Tab or Alt+← | Promote a section |
| Alt+→ | Make it a child of the preceding sibling |
| Alt+↑ / Alt+↓ | Move before / after a sibling |
| ↑ / ↓ / ← / → | Select previous sibling / next sibling / parent / first child |
| Delete | Open the deletion dialog |
| Ctrl/Cmd+Enter | Focus the section body editor |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | Undo / redo a structural edit |

When creating headings inline, **Enter** confirms and starts another sibling; **Tab** confirms and starts a child. **Esc** cancels the draft. In the body editor, undo/redo edits text; **Esc** returns focus to the map. The editor supports Markdown highlighting and Ctrl/Cmd+B/I/K for bold, italic, and links.

Drag the divider to resize the body panel, or hide it through the more menu. The filename root provides access to text before the first heading and lets you add top-level sections; it does not rename the file. Mode and split-view state can be restored when reopening; undo history lasts only for the current session.

Edits update the original Markdown. If another editor has unsaved changes, save there first and refresh the map. External refreshes preserve unsaved body drafts; failed saves on closing offer draft recovery. Renaming headings does not update links in other notes. See the [Writing Mode guide (Chinese)](docs/mind-map-writing-mode.md) for conflict handling and current editor/line-ending limitations.

The existing features below describe **Native Canvas**. Its title/body content options are separate from rendering modes.

## Features

- **One-click generation**: Generate a mind map from a Markdown note card or a text card containing headings. Supports H1–H6 headings.
- **Two content modes**: Title-only mode is ideal for reviewing structure, while body mode lets you read section content directly alongside the outline.
- **Seven layouts**: Radial, bidirectional horizontal, bidirectional vertical, and four one-way tree layouts: right, left, down, and up. Layouts can be switched at any time after generation.
- **Progressive expansion**: Collapse an entire branch, expand only the next level, or display the mind map up to a specified depth.
- **Links to the source note**: Heading cards generated from notes link directly to their corresponding sections. Text-source cards display headings directly.
- **Per-level appearance settings**: Customize width, height, color, and automatic height for the center node and each level. Individual nodes can also be adjusted separately.
- **Refresh from source**: Update the mind map after the original note structure changes while preserving manual edits to matching nodes. Confirmation is required before removing unmatched nodes.
- **Native Canvas experience**: Card editing, additional connections, undo, and redo remain available. Mind maps are stored directly in the Canvas, so the cards remain even if the plugin is disabled.

## Installation

### Method 1: Install from the Obsidian Community Plugins directory (Recommended)

1. Open Obsidian and go to **Settings → Community plugins**.
2. Click **Browse** and search for **Canvas Mind Map**.
3. Click **Install**, then click **Enable** after the installation is complete.

### Method 2: Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the same version on the [GitHub Releases page](https://github.com/Zenolzx/Canvas-Mind-Map/releases).

2. Open your Obsidian vault directory and navigate to `.obsidian/plugins/`. Create a folder named `canvas-mind-map`:

   ```text
   .obsidian/plugins/canvas-mind-map/
   ```

3. Place `main.js`, `manifest.json`, and `styles.css` inside this folder. The final directory structure should look like this:

   ```text
   .obsidian/
   └── plugins/
       └── canvas-mind-map/
           ├── main.js
           ├── manifest.json
           └── styles.css
   ```

4. Reload Obsidian, go to **Settings → Community plugins**, find **Canvas Mind Map**, and enable it.

> If the plugin does not appear in the list, make sure all three files are located directly inside `.obsidian/plugins/canvas-mind-map/`, then restart Obsidian.

Requires **Obsidian 1.7.7 or later**.

If you previously used the mind map functionality from Enhanced Canvas, disable the old plugin first. Existing mind map metadata from the old implementation is currently not compatible.

## Native Canvas Quick Start

1. Open a Canvas and add a Markdown note, or create a text card containing headings.
2. Select the card and right-click **Generate collapsible mind map**. You can also run the same command from the Command Palette.
3. Choose **Title only** or **Include body**, select a layout, and click **Generate**. The plugin remembers your most recent selection.
4. Click the **＋ / −** control below a node to expand or collapse its branch.

The default configuration is **Title only + Bidirectional horizontal layout**, displaying the mind map up to level 2. Saved layout preferences remain respected.

If the source contains only one top-level heading, that heading becomes the center node. If there are multiple top-level headings, they are arranged around the note center.

Generating a mind map replaces the source card and reconnects existing external edges to the new center node. The operation can be reverted with Undo.

### Adjusting the Mind Map

Open the context menu on any mind map node to:

- Navigate using **Return to center / Focus branch / Show overview / Search titles**.
- **Expand / Collapse** groups progressive expansion, branch collapse and show-to-level actions.
- **Layout** groups layout switching and relayout.
- **Appearance** groups node appearance, level templates, branch appearance and restoring a node template.
- **Refresh from source note** synchronizes the heading structure. Existing Command Palette actions remain available.

Each mind map stores its layout independently.

All seven layouts pack complete subtrees using actual card dimensions and progressively shorter base gaps. Radial layout allocates sectors by subtree weight. Expansion fixes the clicked card and its ancestor path and arranges its descendants; other first-level branches and ordinary Canvas cards remain in place. Subtrees can extend outward to avoid obstacles. Explicit relayout rearranges the entire map and replaces manual positions.

New maps use branch colors: descendants and native edges inherit their first-level branch's palette identity. Title mode also uses lightweight cards and typography hierarchy; body mode retains its reading space. Existing maps are unchanged on load: use **Relayout** for improved geometry and **Options → Apply branch appearance (keep customizations)** for the new appearance. Manual card colors, dimensions and edge colors are preserved. **Restore level template** resets a single card. Native curves remain rendered by Obsidian.

During refresh, if an existing node cannot be matched—for example because a heading was deleted, renamed, moved to another parent, or duplicated—the plugin displays a confirmation dialog before applying the changes.

## Build from Source

Node.js and npm are required:

```sh
npm install
npm run build
```

The production build checks TypeScript and generates `main.js`. Copy it with `manifest.json` and `styles.css` into your vault's plugin directory. For development, `npm run dev` rebuilds on source changes; stop it with Ctrl+C.

## Feedback

Report bugs and suggestions through [GitHub Issues](https://github.com/Zenolzx/Canvas-Mind-Map/issues). Include your Obsidian and plugin versions, rendering mode, View/Edit mode, layout, reproduction steps, and a shareable minimal note.

## Credits and License

Based in part on [Enhanced Canvas](https://github.com/RobertttBS/obsidian-enhanced-canvas), including Canvas integration and helper implementations. Thanks to its author and contributors.

Licensed under the [MIT License](LICENSE), with upstream copyright notices preserved.
