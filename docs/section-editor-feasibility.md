# Section Editor 接入验证

## 已确定的边界

Obsidian 公开的 `Editor` 操作完整文档；当前项目安装的 API 声明没有可直接创建、限定 section 范围的编辑器工厂。`MarkdownView` 的正文仍是整个文件。不能通过修改其 `setViewData`，把局部正文当成完整文件交给保存机制。

候选方案是嵌入 CodeMirror 6，UI 层只提交正文变更，文档结构和实际保存继续经过 transaction service。语法、历史、快捷键和 Obsidian 链接行为需要分别验证，不能认为嵌入 CodeMirror 就自动具备全部 Obsidian 编辑能力。

依据：[Obsidian Editor](https://docs.obsidian.md/Plugins/Editor/Editor)、本地 `obsidian.d.ts` 的 `Editor`、`TextFileView`、`MarkdownView` 声明。

## 本轮已实现：局部变更保留原始换行

`src/document/SectionTextBuffer.ts` 是纯内存、不可变的正文坐标转换层。编辑器使用 UTF-16 / LF 坐标；文件原文保留 CRLF、LF、CR。将有序变更映射到原始正文范围后，只替换被编辑的字符。新增换行使用传入的文件换行策略。

- 验证编辑器快照，拒绝过期变更。
- 拒绝越界、重叠、逆序和同位置的歧义变更。
- 保留未编辑区域的原始字符，包括 BOM 和混合换行。
- 不执行文件 IO，不保存到插件设置，不承担 Undo。

`scripts/verify-section-text.cjs` 包含 9 项检查，其中连续编辑检查执行 500 次变更。它验证坐标转换，不代表已经完成 CodeMirror 集成验证。

## 已实现的接入防护

1. **跨编辑器写入窗口**：`Vault.process` 提供文件层原子读改写，但不能据此保证所有未保存编辑缓冲同步。即使同步回调中检查了缓冲，异步写入结束前仍可能出现新输入。实际 commit adapter 必须解决整个提交期间的编辑权协调；未经证明的同步状态应拒绝写入。
2. **正文生成新标题**：一次 `updateBody` 后，原正文可能拆成多个 section。不能继续把旧编辑器的完整内容写入原节点的最新 direct body，否则会重复新建的子章节。需要带版本和保存代次的草稿会话，并测试写入过程中继续输入。
3. **未闭合 Markdown**：用户输入代码块开头时可能暂时不满足结构验证。保留内存草稿及错误状态，不能刷新覆盖草稿或切换节点丢弃输入。
4. **Undo 与换行**：编辑器通常记录规范化文本；删除混合换行后，简单反向插入 LF 无法恢复原始字节。需验证原文历史元数据与编辑器历史分组、撤销、重做的整合。
5. **IME 与选择范围**：组合输入期间不能重建编辑器或重绑定 section；提交后光标映射必须覆盖中文和 emoji。

文件原子性依据：[Obsidian Vault](https://docs.obsidian.md/Plugins/Vault)。编辑缓冲同步另由宿主适配器管理，真实宿主验证结果见下文。

## 当前状态（已完成接入）

已安装并锁定 CodeMirror 依赖，已接入 Organic View/Edit、正文分栏及实际文件提交。上文列出的风险通过以下机制处理：

- `ObsidianDocumentHost` 为一次提交持有短暂编辑锁，等待已开始的原生保存，延迟新的原生保存；在 `Vault.process` 回调核对文件和全部可识别编辑缓冲，完成后同步已验证缓冲并释放延迟保存。
- 提交期间的原生编辑器暂不接受文本修改，并给出提示。无法确认同步的编辑缓冲会阻止提交。
- 如果原文含 CR/CRLF 且同文件存在普通 Markdown 编辑页，拒绝结构提交并提示先关闭该页，避免原生保存机制归一化原始换行。仅在 Writing Mode 中编辑此类文件时保留原换行。
- 写入后报错时重新读取文件证据，不回滚文件。若无法确认结果，取消延迟的原生保存并保留缓冲，避免旧内容覆盖可能成功的写入。
- 正文保存前短暂设为只读；保存完成后，如输入产生新 heading，按事务返回的选区重绑定直属正文。保留编辑器焦点。
- 未闭合 Markdown 和外部冲突不会清除草稿。刷新前提供明确的放弃草稿确认；关闭标签页保存失败时展示可复制的恢复窗口。
- CodeMirror `invertedEffects` 记录原始换行信息，Undo/Redo 能恢复混合换行。IME 组合期间延后保存。

验证包括 Node 引擎测试、真实浏览器 CodeMirror/Organic 流程、以及已安装 Obsidian 的隔离临时库测试。真实宿主已验证普通 Markdown 页同步、延迟自动保存、正文保存、撤销恢复原文、外部编辑冲突和 View/Edit 共享会话。测试未修改用户已有笔记库。
