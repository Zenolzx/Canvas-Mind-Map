# Canvas Mind Map 1.2.0 — A clearer space for your ideas

This release refreshes the workspace around your notes, outlines and drafts, and improves coexistence with Enhanced Canvas.

## What's new

- **A coordinated workspace design.** Updated toolbars, navigation, panels and node hierarchy give the map, writing editor and free canvas a consistent structure. Panels adapt to the available pane width.
- **New canvas surfaces and palettes.** New installations start with Mineral paper and a paper surface. Forest mist, Terracotta, Muted lavender, Midnight graphite and Follow Obsidian offer alternatives; plain, dots, grid and paper surfaces can be chosen independently. Existing saved preferences are retained.
- **Preview before applying.** The appearance picker previews a complete map and restores the previous appearance when cancelled. Procedural materials replace bundled wallpaper assets; vault images remain available as custom backgrounds.
- **More resilient Canvas integration.** Integration waits for actual Canvas views, including those opened after startup. An unopened Canvas no longer produces a false compatibility warning, and hooks are cleaned up when views close or the plugin unloads.
- **Enhanced Canvas coexistence.** Both loading orders were tested against the official 1.0.33 source build, including menus, folding, persistence, ordinary file-card property sync and disabling either plugin.
- **Explicit legacy-map migration.** The local Enhanced Canvas 1.0.29 modification containing an early mind-map engine can transfer a map to Canvas Mind Map while retaining node IDs, geometry, content and fold state. Native Canvas undo restores the old ownership; the legacy engine leaves migrated maps alone.
- **Rewritten English and Chinese documentation.** A shorter visual introduction, separate detailed guides, and clearer saving, file-format and compatibility boundaries.

## Before updating

- The manifest continues to require Obsidian **1.7.7 or later**. This release's coexistence checks were performed on desktop; mobile has not been validated.
- Existing saved appearance preferences are retained. To try the new default appearance, choose **Mineral paper → Paper** in the workspace appearance picker.
- Legacy maps are **not migrated automatically**. The 1.0.29 build mentioned above is a local modification, distinct from official Enhanced Canvas.
- Title maps use text cards; their edges do not participate in Enhanced Canvas's file-card frontmatter sync.
- DOCX editing remains limited to supported headings and plain-text bodies. PDF remains read-only. Composer free-canvas objects stay in the draft and are not inserted into Markdown.

## Install or update

Update through **Settings → Community plugins → Check for updates** when available. For manual installation, download this release's `main.js`, `manifest.json` and `styles.css`, place them in `.obsidian/plugins/canvas-mind-map/`, and reload Obsidian.

[User guide](https://github.com/Zenolzx/Canvas-Mind-Map/blob/1.2.0/docs/user-guide.en.md) · [Compatibility details](https://github.com/Zenolzx/Canvas-Mind-Map/blob/1.2.0/docs/enhanced-canvas-compatibility.md)

---

# Canvas Mind Map 1.2.0 — 更清晰的思考与写作空间

本次更新重新整理了笔记、脑图与草稿周围的工作区，并改进与 Enhanced Canvas 的共存体验。

## 主要更新

- **统一工作区设计。** 调整工具栏、导航、面板与节点层级，让脑图、写作和自由画布拥有一致的操作结构；面板按实际分栏宽度适配。
- **新的配色与画布材质。** 新安装默认使用“矿物纸面 + 纸纹”。另有雾林、陶土、雾紫、深夜石墨和跟随 Obsidian；纯色、点阵、方格与纸纹可独立选择。已有外观偏好继续保留。
- **应用之前先预览。** 外观选择器展示完整脑图，取消后恢复原状。程序化材质取代内置壁纸素材，仍可使用仓库图片作为自定义背景。
- **更稳健的 Canvas 接入。** 等待实际视图加载，支持启动后才打开的 Canvas；未打开画布时不再误报兼容问题，关闭视图或停用插件时清理接口。
- **Enhanced Canvas 共存验证。** 官方 1.0.33 源码构建版的两种加载顺序均通过实测，覆盖菜单、折叠、保存、普通文件卡片属性同步及分别停用。
- **旧导图显式迁移。** 本机带早期脑图引擎的 Enhanced Canvas 1.0.29 改版，可将导图转交给 Canvas Mind Map，保留节点 ID、位置、内容与折叠状态；支持原生撤销，迁移后旧引擎不会重复处理。
- **重写中英文文档。** 首页介绍更集中，详细操作独立成册，并明确保存方式、文件格式和兼容范围。

## 更新前了解

- 清单继续要求 **Obsidian 1.7.7 或更高版本**。本次共存验证在桌面端完成，尚未验证移动端。
- 已保存的外观偏好继续保留。想体验新的默认外观，可在工作区外观中选择**矿物纸面 → 纸纹**。
- **不会自动迁移旧导图。** 上述 1.0.29 为本机改版，与官方 Enhanced Canvas 不同。
- 标题脑图使用文本卡片，其连线不参与 Enhanced Canvas 的文件卡片属性同步。
- DOCX 仍只编辑受支持的标题和纯文本正文，PDF 仍为只读。Composer 自由画布对象保存在草稿中，不写入 Markdown。

## 安装与更新

可在**设置 → 第三方插件 → 检查更新**中更新。手动安装请下载本 Release 的 `main.js`、`manifest.json` 和 `styles.css`，放入 `.obsidian/plugins/canvas-mind-map/` 后重新加载 Obsidian。

[使用手册](https://github.com/Zenolzx/Canvas-Mind-Map/blob/1.2.0/docs/user-guide.zh-CN.md) · [兼容性说明](https://github.com/Zenolzx/Canvas-Mind-Map/blob/1.2.0/docs/enhanced-canvas-compatibility.md)
