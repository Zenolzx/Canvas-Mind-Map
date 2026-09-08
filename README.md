<div align="right">

[简体中文](README.zh-CN.md) | **English**

</div>

# Canvas Mind Map

**Turn Markdown notes into collapsible, navigable, and freely arranged mind maps.**

Canvas Mind Map is an Obsidian plugin that converts the heading hierarchy of your notes into native Canvas cards, allowing you to browse document structure, expand details, and jump back to the original note for further reading.

## Features

- **One-click generation**: Generate a mind map from a Markdown note card or a text card containing headings. Supports H1–H6 headings.
- **Two content modes**: Title-only mode is ideal for reviewing structure, while body mode lets you read section content directly alongside the outline.
- **Seven layouts**: Radial, bidirectional horizontal, bidirectional vertical, and four one-way tree layouts: right, left, down, and up. Layouts can be switched at any time after generation.
- **English and Simplified Chinese UI**: Follow Obsidian automatically or choose a language in the plugin settings.
- **Progressive expansion**: Collapse an entire branch, expand only the next level, or display the mind map up to a specified depth.
- **Branch reading**: Focus a branch from its context menu. Its visible descendants are temporarily rearranged into a compact local layout while the anchor and ancestor path stay fixed. The reading bar can hide or dim other content and toggle compact layout. Exit restores the original positions, folding state, selection, and viewport.
- **Search and navigation**: Search titles and section paths, including folded nodes. Choosing a result expands its ancestor path and selects it. Use the context menu overview action to navigate the overall structure.
- **Links to the source note**: Heading cards generated from notes link directly to their corresponding sections. Text-source cards display headings directly.
- **Per-level appearance settings**: Customize width, height, color, and automatic height for the center node and each level. Individual nodes can also be adjusted separately.
- **Refresh from source**: Update the mind map after the original note structure changes while preserving manual edits to matching nodes. Confirmation is required before removing unmatched nodes.
- **Native Canvas experience**: Card editing, additional connections, undo, and redo remain available. Mind maps are stored directly in the Canvas, so the cards remain even if the plugin is disabled.

## Installation

Manual installation is currently supported:

1. Obtain the three plugin files: `main.js`, `manifest.json`, and `styles.css`. If no release package is available yet, build the plugin from source using the instructions below.

2. Create the folder `.obsidian/plugins/canvas-mind-map/` inside your vault and place the three files in it.

3. Reload Obsidian, then enable **Canvas Mind Map** under **Settings → Community plugins**.

Requires **Obsidian 1.7.7 or later**.

If you previously used the mind map functionality from Enhanced Canvas, disable the old plugin first. Existing mind map metadata from the old implementation is currently not compatible.

## Quick Start

1. Open a Canvas and add a Markdown note, or create a text card containing headings.

2. Select the card and right-click **Generate collapsible mind map**. You can also run the same command from the Command Palette.

3. Choose **Title only** or **Include body**, select a layout, and click **Generate**. The plugin remembers your most recent selection.

4. Click the **＋ / −** control below a node to expand or collapse its branch.

The default configuration is **Title only + Radial layout**, displaying the mind map up to level 2.

If the source contains only one top-level heading, that heading becomes the center node. If there are multiple top-level headings, they are arranged around the note center.

Generating a mind map replaces the source card and reconnects existing external edges to the new center node. The operation can be reverted with Undo.

### Adjusting the Mind Map

Open the context menu on any mind map node to:

* **Show to level N** to control how much detail is visible.

* **Return to center** to quickly navigate back to the root.

* **Switch layout / Relayout** to rearrange the entire tree.

* **Set node appearance**, or apply level templates from the plugin settings to the whole tree.

* **Refresh from source note** to synchronize changes in the heading structure.

Each mind map stores its layout independently.

Switching layouts rearranges node positions. In the six directional layouts, expansion reserves space for entire subtrees and reflows neighboring branches on the same side while keeping the clicked node and viewport fixed. Bidirectional generation and full relayout balance larger subtrees first. Radial layout retains its existing angular placement.

Branch focus keeps the focused card and ancestor path fixed, temporarily reflows only its visible descendants, and fits that subtree to the viewport. A non-center branch continues growing in its existing direction; radial branches receive a wider forward sector instead of retaining a narrow slice of the full map. Hide mode prioritizes a compact result, while dim mode avoids visible background cards. Folding and node movement during focus are view-local. Structural and content edits still save normally. Exit restores existing nodes to their original positions together with the previous folding state, selection, and viewport; nodes created during focus keep their new positions.

Compact focus layout is enabled by default. Disable its default under **Settings → Canvas Mind Map → Branch focus**, or toggle **Compact layout** in the reading bar for the current focus session. The hide/dim preference is remembered, while focus itself is never saved. Search exits focus before revealing its result.

### Language

Under **Settings → Canvas Mind Map → Language**, choose **Automatic**, **English**, or **Simplified Chinese**. Automatic uses Simplified Chinese for `zh-CN`/`zh-Hans` Obsidian locales and English for every other locale. Newly generated fallback labels use the active language; existing Canvas content is never translated or rewritten.

During refresh, if an existing node cannot be matched—for example because a heading was deleted, renamed, moved to another parent, or duplicated—the plugin displays a confirmation dialog before applying the changes.

## Build from Source

Node.js and npm are required:

```sh
npm install
npx tsc --noEmit
npm run dev
```

The development build writes `main.js` and keeps watching for source changes. Copy it together with `manifest.json` and `styles.css` into the plugin directory. Stop the watcher with `Ctrl+C`.

## Feedback

Please open an [issue](https://github.com/Zenolzx/Canvas-Mind-Map/issues) for bugs or feature requests. For display issues, include your Obsidian version, content mode, layout, reproduction steps, and a minimal shareable note when possible.

## Credits and License

This project builds on parts of [Enhanced Canvas](https://github.com/RobertttBS/obsidian-enhanced-canvas), including Canvas integration and supporting utilities. Canvas Mind Map focuses that foundation on collapsible mind maps, multiple layout directions, a unified generation flow, and mind map management.

Licensed under the [MIT License](LICENSE), retaining upstream copyright notices and identifying this project's contributors.
