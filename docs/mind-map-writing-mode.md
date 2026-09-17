# Mind Map Writing Mode

Think in a mind map. Write in Markdown.

在 Organic 顶部选择 **Edit**。脑图编辑章节结构，右侧 CodeMirror 编辑当前标题的直属正文。所有提交写入同一个 `.md` 文件；Native Canvas 和 Organic 阅读功能保留。

## 操作

| 脑图获得焦点时 | 操作 |
| --- | --- |
| 单击 | 选择章节并加载直属正文 |
| 双击 / F2 | 内联改名；Enter 确认、Esc 取消 |
| Enter | 添加同级章节，位置在当前整个子树之后 |
| Tab | 添加最后一个子章节 |
| Shift+Tab / Alt+← | 提升章节 |
| Alt+→ | 降为前一同级章节的子章节 |
| Alt+↑ / Alt+↓ | 与前一 / 后一同级章节调整顺序 |
| ↑ / ↓ / ← / → | 前一同级 / 后一同级 / 父章节 / 第一个子章节 |
| Delete | 打开安全删除对话框 |
| Ctrl/Cmd+Enter | 聚焦正文编辑器 |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | 结构 Undo / Redo |

创建标题时，Enter 确认并继续创建下一个同级标题；Tab 确认并创建子标题。空草稿按 Esc 取消，不生成占位文字。IME 组合输入的 Enter 不会误提交。

拖动标题会移动整个 Markdown 子树，包括正文和后代。目标提供 **Before / Make child / After** 三个区域及预览。松手才写入；循环、自己拖到自己、超过 H6 的操作会被拒绝。

右侧正文支持 Markdown 高亮、原生 CodeMirror 历史、选择、粘贴、Tab 缩进、Ctrl/Cmd+B/I/K 和 Ctrl/Cmd+点击链接。Esc 返回脑图。输入会自动保存；正文变化不重算脑图布局。正文中新建标题后会重新绑定正确的章节，并保留光标和焦点。

## 文档与状态

- 虚拟根显示文件名，仅用于导航和新增顶层章节，不写入 Markdown，不重命名文件。
- 根节点的正文区域显示第一个标题之前的 introduction，不伪造 heading。
- 小圆点表示直属正文是否有内容；悬停查看字/词数。
- 拖动分栏边界调整宽度；“更多”中可以隐藏正文、Undo、Redo。
- View/Edit 共享当前文档会话与历史。重开时恢复模式、宽度、选区、视口、折叠和分支样式；历史仅留在内存。
- 外部重命名保留当前节点身份并重新核对源文件；旧路径的历史被清空。

## 冲突与内容保护

结构操作只修改必要的源范围，不重建整篇 Markdown。事务提交前核对完整原文、版本、目标和范围；候选结果重新解析并验证。文件写入失败不会触发盲目回滚。

普通 Markdown 编辑页有未同步内容时，操作被取消。先让普通编辑器保存，再刷新脑图。未保存的右侧草稿不会被外部刷新覆盖；用户可以复制后明确放弃草稿并刷新。关闭标签页时若保存失败，会显示草稿恢复窗口。

原文包含 CR/CRLF 时，如同一文件还开着普通 Markdown 编辑页，需要先关闭该页再提交。这是当前版本保留原始换行的限制。Writing Mode 自身支持 CRLF、LF、CR 及混合换行。

公开 API 无法识别或协调的嵌入式编辑器会导致提交被拒绝；不会假定未知缓冲已经同步。插件不更新其他文件中的 heading 链接。

## 验证

- `npm test`：Native、Organic、结构引擎、事务、冲突、原文换行、CodeMirror Undo、状态恢复。
- `npm run test:writing-browser`：真实浏览器中的 A–I 场景、输入生成标题、IME、草稿恢复、重开状态、宿主保存竞争及实际指针拖拽。
- 浏览器运行器通过 `CMM_PLAYWRIGHT` 和 `CMM_BROWSER` 接受 Playwright 包与 Chromium 可执行文件路径。
- `scripts/verify-writing-live.cjs`：仅连接本地端口 9237 的隔离 Obsidian 测试实例；先核对 vault 的绝对路径，绝不对其他 vault 执行测试。

本轮结果：98 项文档与原文检查、CodeMirror Undo/Redo 与状态恢复检查全部通过；Native / Organic 原有回归全部通过；浏览器 A–I、实际指针拖拽、保存竞争、预览页隐藏旧缓冲、关闭编辑页、跨文件切换均通过。真实 Obsidian 隔离库验证了编辑页和阅读预览页同步、正文保存、逐字撤销恢复、外部修改冲突及会话复用。TypeScript 与生产构建通过。

性能测试覆盖 50 / 200 / 500 个标题；刷新和提交仅处理当前文件。测试报告区分 Node、浏览器模拟宿主和真实 Obsidian，不把其中一种当成另外一种的证明。
