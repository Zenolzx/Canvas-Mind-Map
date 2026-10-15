# Canvas Mind Map 1.1.1

This maintenance release addresses the Obsidian Community Plugins review feedback for 1.1.0.

## Changes

- Move fixed DOCX editor and dialog input styles into scoped CSS classes.
- Use Obsidian's CSS style helpers for Composer's measured input height and drag feedback positions, preserving the existing layout and interactions.
- Add a local Obsidian ESLint check so the static-style rule blocks future releases.
- Tighten one persisted-data type boundary.

Canvas, Organic, View, Composer, Sketch, DOCX, PDF, themes, settings, and saved data remain compatible with 1.1.0.

## Installation

Update through Obsidian Community Plugins when available. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from this release into `.obsidian/plugins/canvas-mind-map/`, then reload Obsidian. Requires Obsidian 1.7.7 or later.

---

# Canvas Mind Map 1.1.1（简体中文）

此维护版本修复 1.1.0 在 Obsidian 社区插件审核中发现的样式赋值问题。

## 更新内容

- 将 DOCX 编辑区和对话框输入框的固定样式移入插件专属 CSS 类。
- 使用 Obsidian 的样式辅助方法处理 Composer 输入框动态高度与拖拽提示位置，保持原有布局和交互。
- 增加本地 Obsidian ESLint 检查，防止静态样式赋值问题再次进入发布版本。
- 收紧一处持久化数据的类型边界。

Canvas、Organic、View、Composer、Sketch、DOCX、PDF、主题、设置和已有数据均与 1.1.0 兼容。

## 安装

社区插件目录提供更新后，可在 Obsidian 中更新。手动安装请下载本 Release 的 `main.js`、`manifest.json`、`styles.css`，放入 `.obsidian/plugins/canvas-mind-map/` 后重新加载 Obsidian。需要 Obsidian 1.7.7 或更高版本。
