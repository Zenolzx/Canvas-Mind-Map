<div align="right">

[简体中文](README.ch.md) | **English**

</div>

# Canvas Mind Map

**Turn Markdown notes into collapsible, navigable, and freely arranged mind maps.**

Canvas Mind Map is an Obsidian plugin that converts the heading hierarchy of your notes into native Canvas cards, allowing you to browse document structure, expand details, and jump back to the original note for further reading.

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

1. Obtain the three required plugin files: `main.js`, `manifest.json`, and `styles.css`. You can download the corresponding version from the GitHub Releases page. If pre-built files are not available, you can also build the plugin from source by following the instructions in the repository.

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

- **Show to level N** to control how much detail is visible.
- **Return to center** to quickly navigate back to the root.
- **Switch layout / Relayout** to rearrange the entire tree.
- **Set node appearance**, or apply level templates from the plugin settings to the whole tree.
- **Refresh from source note** to synchronize changes in the heading structure.

Each mind map stores its layout independently.

Switching layouts rearranges node positions, while normal expansion preserves existing card positions.

During refresh, if an existing node cannot be matched—for example because a heading was deleted, renamed, moved to another parent, or duplicated—the plugin displays a confirmation dialog before applying the changes.

## Build from Source

Node.js and npm are required:

```sh
npm install
npx tsc --noEmit
npm run dev