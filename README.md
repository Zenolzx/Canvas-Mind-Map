<div align="right">

[简体中文](README.zh-CN.md) | **English**

</div>

# Canvas Mind Map

**Think in a mind map, create a Markdown note, and keep writing.**

Canvas Mind Map offers three workspaces: **Native Canvas** for native cards, **Organic** for existing Markdown, DOCX, and PDF files, and **Composer** for creating a new document from a blank mind map. Organic and Composer share the curved-branch renderer and layouts, but save to different sources.

Available in the **Obsidian Community Plugins directory**. [Open the plugin page](https://obsidian.md/plugins?id=canvas-mind-map) · [Download releases](https://github.com/Zenolzx/Canvas-Mind-Map/releases).

This README describes the current source, including Composer's thinking and writing tools (v1.1 / v1.2 roadmap). Features available in a packaged version are listed in its [release notes](https://github.com/Zenolzx/Canvas-Mind-Map/releases).

## Choose a mode

| Mode | Source and saving | Purpose | Entry point |
| --- | --- | --- | --- |
| Native Canvas | Native Canvas nodes and edges | Seven layouts, movable cards and native Canvas interaction | Generate a mind map from a Canvas Markdown, DOCX, PDF, or text card |
| Organic | An existing `.md`, `.docx`, or `.pdf` file | **View** reads/navigates all three; **Edit** writes to Markdown or DOCX | Right-click a supported file → **Open note in Organic mode**, or run that command |
| Composer | A plugin draft; no `.md` file until **Create Note** | Start blank or from a template, collect ideas, organize and write | Ribbon / command **New Mind Map Document**, or folder menu **New Mind Map Document here** |

For a new document, start with [Composer](#composer--new-mind-map-document). For an existing note, use [Organic Edit](#edit--mind-map-writing). For movable cards, follow [Native Canvas Quick Start](#native-canvas-quick-start). **View / Edit** are states inside Organic; Native's **title / body** choices control card content, not the workspace mode.

```text
New Mind Map Document → Composer draft → Create Note → Organic Edit ⇄ View
```

### Word and PDF sources

DOCX headings come from paragraph heading styles or outline levels. Organic Edit writes heading changes, section moves, additions, deletions, and plain-text direct bodies back to the original `.docx`. Direct bodies containing tables, images, fields, tracked changes, or rich formatting are read-only; moving a chapter retains its underlying Word blocks. DOCX undo/redo applies to the current editing session. Native Canvas generates and refreshes cards from DOCX but does not change the document.

PDF uses its bookmarks as the mind-map structure and extracts selectable page text for reading. Without bookmarks, the map has one document node. Scanned or protected PDFs that do not expose text cannot be mapped. PDF remains read-only in both modes. Legacy `.doc` and OCR are not supported.

### Organic reading and navigation

Organic opens in its own tab and never converts or overwrites a `.canvas` file. In View mode, a sole top-level heading becomes the center; otherwise the note name is used. Notes without headings show the note name. Initially the center (depth 0) and two descendant levels are visible. Click a heading to open its source line, including repeated headings; use the small +/− controls to fold branches. Folding preserves branch color, side, order and the clicked heading's screen position.

Drag the background to pan, scroll to zoom around the pointer, or use the toolbar's zoom and **Fit to view** controls. With the background focused, arrow keys pan, +/− zoom and 0 fits the map. Headings and fold controls are keyboard accessible.

Organic automatically refreshes after source changes (500ms debounce), preserving matched heading state and the viewport. **Refresh** remains available. Heading identity is reconciled using section content and hierarchy; ambiguous edits safely discard unmatched state. Source navigation still checks for stale content before jumping.

Use **Search headings** or Ctrl/Cmd+F inside Organic to search all headings, including folded descendants. Enter/Shift+Enter moves between results; Esc clears search. Right-click a heading to **Focus branch** or **Read this branch**. Focus shows its subtree and ancestor path; Reading follows Markdown order with ↑/↓ and smooth viewport movement. Search outside a focused branch temporarily suspends Focus and restores it when cleared. Temporary expansion does not overwrite manual folding.

The layout selector offers **Organic Radial**, **Organic Horizontal**, and **Compact Organic**. Fold animations respect reduced motion. **Export → SVG / PNG** saves the current visible structure (including Focus and folding) next to the source note, with numbered filenames to avoid overwriting. PNG defaults to 2x; 1x/2x/3x are available in settings. Very large PNG dimensions are rejected with a suggestion to reduce scale or use SVG.

Folding, zoom, viewport center, Focus, Reading position, selection and layout are stored in plugin data by source path. Rename/move migrates saved state; deletion removes it. Multiple tabs interact independently; the most recent user interaction owns the saved state. Settings provide automatic refresh, remembered state/reset, default layout, animation/duration and PNG scale. **View** explores the note; **Edit** writes changes to the source Markdown and provides its own editing history.

## Composer / New Mind Map Document

### Start and write

1. Use **New Mind Map Document** in the ribbon or command palette. A folder's **New Mind Map Document here** action remembers that folder for the first note creation.
2. Rename **Untitled** with F2 / double-click. This is the document name, not automatically a Markdown H1 or a file.
3. Select a node and press Enter for a sibling, Tab for a child, or click the `+` shown on hover/focus. Type **inside the node**. Enter confirms without creating another node; press Enter again to start the next sibling. Tab while editing confirms and starts a child. Esc cancels the rename or the unfinished new node. Double-click / F2 edits an existing title in place.
4. Selection shows a one-line **direct body** preview at the bottom of the canvas. Click it (or **Add body…**) or press Ctrl/Cmd+Enter to open the right editor. The root body is the introduction. The editor stays closed until requested; **View → Body: Auto / Show / Hide**, Pin and the divider remain available.
5. Choose **Create Note**, review the export options and Markdown preview, then create the file. The current tab becomes **Organic Edit**.

The root suggests a filename, which can be changed independently in the create dialog. **Document name only** exports children as H1; **Use root as H1** exports the root as H1 and children as H2. Structural operations and root-behavior changes validate the complete subtree against H6. Create section headings as map nodes, rather than placing headings in a heading node's body.

### Organize ideas

- **Ctrl/Cmd+click** adds/removes a selection; **Shift+click** selects a visible range. Body editing applies to the primary selected node. Type changes apply to all selected non-root nodes.
- Right-click → **Create parent from selection** groups siblings and edits the new parent inline. **Duplicate** copies selected branches with fresh IDs. Both preserve bodies, metadata and descendants.
- Drag a node to move its **complete subtree**, or drag a multi-selection as a batch. The top/bottom of a target inserts **before/after** with an insertion line; its middle makes the branch a **child**, highlighted on the target. There is no three-choice popup. A larger exit region and boundary tolerance prevent small pointer movements from losing the target. Cycles, moving the root and excessive heading depth are rejected.
- Drag to the canvas edge to pan or the Inbox edge to scroll. Esc cancels a drag. Existing promote/demote/reorder shortcuts remain; batch deletion still offers the keep-children choice. Each completed structural action is one undo step.
- The selected-node toolbar contains only `…`. Focus, node types, duplication and advanced branch actions live in the context menu; document properties, templates and export tools live in the global `…`. Redundant Add / Move menu entries have been removed.
- **Node type → Heading / Idea / Todo** remains an advanced option. Idea nodes retain a `?` prefix; Todo nodes retain clickable completion checkboxes. Newly created map nodes are headings.

### Ideas Inbox

Open **Ideas** for a docked Inbox that reduces the canvas width instead of covering the map. Toggling it preserves selection and zoom; the selected node stays at its screen position when space permits, with only the minimum pan needed to keep it visible. A narrow window keeps the panels side by side and allows horizontal scrolling.

- Type in **Capture an idea…** and press Enter to create a card and keep typing. Each card can hold a body and shows a one-line preview. Double-click / F2 renames its title inline.
- Pasting multiple lines reveals **As one idea** (first line is the title; remaining lines are the body) and **Split into lines** (one card per non-empty line). Batch creation is a single undo step.
- Search titles and bodies, Ctrl/Cmd-click or Shift-click to select cards, and drag to reorder. Card-to-card drag only sorts; it does not introduce new nesting. Parked subtrees show a descendant count and can be expanded for inspection.
- Drag a map branch into the Inbox to set it aside, retaining its type, descendants, body and metadata. Hover over the closed Ideas entry during a drag to open it.
- **Dragging an Inbox branch into the map adopts it:** every Idea in that branch becomes a Heading; existing headings and Todo completion states stay intact. Moving and adopting undo together. The advanced Idea type remains available through the node menu.

### Find and focus

**Search** or Ctrl/Cmd+F searches **Titles**, **Bodies**, or **Everything**, including folded and unsorted nodes. Enter / Shift+Enter cycles results; Esc closes search. **Focus** shows the selected branch and its ancestor path; **Show overview** restores the document. Search can temporarily show a result outside Focus without changing saved fold flags. The node menu also provides **Expand one level**, **Expand branch**, **Collapse branch**, and **Show to level…**.

### Writing tools

Use **New Composer from template** in the command palette, or **⋯ → New from template**, for Blank, Essay, Project Plan, Meeting Notes, Research Notes or Course Notes. Each opens a new draft. **⋯ → Duplicate draft** makes an independent copy, including bodies, types, properties and unsorted ideas.

**⋯ → Document properties** edits YAML frontmatter without `---` delimiters. It must be a YAML mapping; valid properties are placed before the introduction. **⋯ → Copy outline** copies a Markdown bullet outline, including Todo checkboxes and an Unsorted Ideas group. **⋯ → Document Info** shows counts; the status line stays focused on draft saving.

### Export and saving

**Create Note** checks structure and filenames, uses an existing vault folder, and never overwrites another note. The root-name suggestion and filename can differ. An empty export requires confirmation. **Preview Markdown** shows the same generated text used for creation.

| Content | Export behavior |
| --- | --- |
| Heading | Markdown heading followed by its direct body and children |
| Idea | Explicitly choose **Convert to headings**, **Convert to bullet items**, **Exclude idea branches**, or **Review individually** to change node types first |
| Todo | `- [ ]` or `- [x]` list item |
| Bullet / Todo branch | Descendants become nested list items, including nodes previously typed as headings; bodies remain inside their list items |
| Unsorted Ideas | Explicitly choose **Append to document** or **Exclude and keep draft** |

Excluding an Idea excludes its whole branch. Whenever any content is excluded, the complete draft remains available after note creation. Otherwise it is removed only after Organic Edit initializes successfully. Selection and folding transfer by generated source positions; nodes exported as list items select their nearest exported heading, or the document introduction.

**Draft saved** means plugin data is saved, not that a Markdown file exists. Drafts autosave after 500ms and survive tab closure. **Restore Composer Draft** reopens drafts and provides Rename / Duplicate / Delete plus recovery-data import. Close an open draft before deleting it from that list, or use its **Discard draft** menu. Save failures offer retry and copyable recovery data. Undo history belongs to the current editing session and is not restored after reopening.

### Composer shortcuts

| Key / gesture | Action |
| --- | --- |
| F2 / double-click | Rename the document or node |
| Enter / Tab (node selected) | Add sibling / child |
| Enter / Tab (title editing) | Confirm only / confirm and start a child |
| Esc (title editing / dragging) | Cancel the current title edit or drag |
| Shift+Tab / Alt+← | Promote |
| Alt+→ | Demote below the preceding sibling |
| Alt+↑ / Alt+↓ | Reorder siblings |
| Arrow keys | Navigate visible nodes / parent / first child |
| Delete | Delete selection; branches offer keep-children choice |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | Undo / redo, including body and batch changes |
| Ctrl/Cmd+Enter | Focus direct-body editor; Esc returns to the map |
| Ctrl/Cmd+F | Open Composer search while the map has focus |
| Background drag / wheel / `+` / `-` / `0` | Pan / zoom / zoom / fit |

Horizontal, Radial and Compact reuse Organic's layout and renderer. Composer remembers its layout and panel width defaults independently of Organic.

Composer, Inbox, draft management, templates and Create Note follow the plugin's **Automatic / English / 简体中文** language setting. Open Composer views update when the setting changes; command-palette names update after reloading the plugin. Existing titles and bodies are never translated. Draft schema version 1 remains compatible; unfinished inline titles are not autosaved until committed.

The current Composer remains a document tree. The proposed v2 features—non-tree relationships, shared ideas and free-form knowledge mapping—are not implemented.

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

Run `npm test` for the Native, Organic and Composer model regressions. `npm run test:composer-browser` exercises Composer interactions and the Organic handoff in a headless browser with simulated Obsidian APIs, including inline editing, the docked Inbox, before/child/after hit testing, hysteresis, subtree adoption and bilingual dialogs. Set `CMM_PLAYWRIGHT` to a Playwright module path and `CMM_BROWSER` to a Chromium/Edge executable when using a different local test setup. These tests do not replace checking a real vault.

## Feedback

Report bugs and suggestions through [GitHub Issues](https://github.com/Zenolzx/Canvas-Mind-Map/issues). Include your Obsidian and plugin versions, rendering mode, View/Edit mode, layout, reproduction steps, and a shareable minimal note.

## Credits and License

Based in part on [Enhanced Canvas](https://github.com/RobertttBS/obsidian-enhanced-canvas), including Canvas integration and helper implementations. Thanks to its author and contributors.

Licensed under the [MIT License](LICENSE), with upstream copyright notices preserved.
