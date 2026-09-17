# Mind Map Writing Mode — Phase 0 / Phase 1

## 当前交付边界

本文记录 Phase 0 / Phase 1 的纯引擎架构。引擎本身仅在内存中工作，负责源范围、事务验证、冲突协调和会话内历史。后续 Organic UI、CodeMirror Section Editor 和真实 Vault 提交适配已经完成，见 [Writing Mode 使用说明](mind-map-writing-mode.md)。

Native Canvas 和 Organic 阅读模式的运行路径保持现状。新增引擎不是独立文件格式，也不将 Markdown 内容或历史保存到 plugin data。`DocumentStructure.text` 是当前会话的源文件快照；MindMapModel 是供现有布局/渲染消费的派生投影。

## 已确认的交互与结构语义

- Edit 使用虚拟 document root，root 本身不可重命名、删除或移动；它不写入 Markdown。
- 已有文档的跳级标题保留。新 child 默认 parent level + 1；root child 默认 H1。
- sibling before/after 是目标整个 subtree 的前/后，使用目标 heading level。
- `move(parentId, index)` 的 index 按源 subtree 移除后的目标 children 数组计算。
- Promote 将 section 移到父节点整个 subtree 之后，成为父节点的同级；以父标题级别计算整体差值，而非固定减一。
- Demote 将 section 变为前一个 sibling 的最后一个 child；无前一个 sibling 时拒绝。
- Move/Promote/Demote 必须整体改变 subtree 的标题级别，保留 descendants 的相对级别差；任何节点越出 H1–H6 均拒绝。
- 删除提供 `subtree` 和 `promoteChildren` 两种策略。后者只删除当前 heading，direct body 留在原位置，归入前方仍有效的 section 或 introduction。每个 child 提升为被删除 heading 的同级，自己的 descendants 保持相对级别差。
- 删除确认及内容归属预览属于后续 UI。引擎只接受明确策略，不代表用户已确认破坏性删除。
- Rename 输入只接受单行标题；去掉开头的 Markdown heading syntax，不允许空白草稿提交。
- 后续 inline UI：创建草稿时 Enter 提交并开始下一个 sibling；重命名时 Enter 只确认；空草稿 Esc 不写文件；IME composition 不触发结构快捷键。
- 外部文本变化取消当前操作，刷新后重新选择目标；Phase 1 不做自动 rebase。
- Section body 中输入标题允许产生节点；事务返回光标所在 section 的 selection。后续编辑器接入必须保留输入与焦点，不能后台截断正在输入的内容。

## 当前阅读架构分析

`src/core/HeadingParser.ts` 为现有 Native / Organic 提供 ATX、Setext 标题与行号。其 `content` 使用统一换行与 `trimEnd()`，`endLine` 表示下一个标题，而非整个 subtree 的结束。其 key 包含标题、父路径和重复次数，不能作为跨编辑的写入地址。

`OrganicNodeIdentity` 使用唯一标题、层级 key、正文指纹等启发式恢复阅读身份；不能用其匹配结果批准删除或移动。其持久化 `body` 字段是指纹，并非正文副本。

`OrganicMindMapView` 负责文件加载、revision guard、导航与编排。其刷新已有结构签名比较，可以在正文变化时跳过布局；导航会先比较源文本。`OrganicAutoRefreshController` 的 500ms debounce 可复用为调度，但不能充当写入锁。`OrganicStateStore` 的 owner、750ms 保存防抖、rename/delete 和视口状态可在后续扩展。

布局、renderer、viewport、interaction、animation 已经拆分，后续 WritingController 应复用这些边界。不要把新文件编辑逻辑放进 renderer 或继续扩张 view。

## 文件与职责

| 文件（位于 `src/document/`） | 职责 |
| --- | --- |
| `DocumentStructure.ts` | 精确源范围、section、运行时 document、错误与诊断 |
| `DocumentStructureParser.ts` | Markdown block 识别、源行到 UTF-16 offset、section tree |
| `StructureOperation.ts` | 八类操作及 moveBefore/moveAfter、选择和视图快照 |
| `MarkdownStructureWriter.ts` | 带原文前置条件的范围编辑与确定性身份锚点 |
| `DocumentStructureTransactionService.ts` | 操作合法性、生成 candidate、校验意图、返回 selection |
| `StructureValidator.ts` | 范围覆盖、父子关系、标题/级别/顺序、受保护 preamble 校验 |
| `DocumentCommitAdapter.ts` | 宿主原子写入与编辑缓冲同步契约；没有真实 IO 实现 |
| `DocumentChangeCoordinator.ts` | 当前文件写队列、冲突、自己/外部事件识别、刷新、Undo/Redo |
| `StructureHistory.ts` | 有界会话历史及选中/视口快照 |
| `MindMapProjection.ts` | 现有 MindMapModel 的只读适配，始终保留虚拟 root |
| `index.ts` | 对外导出 |

新增测试位于 `scripts/verify-document-{structure,transactions,conflicts}.cjs`，公用加载器为 `scripts/document-test-utils.cjs`，真实语法夹具位于 `scripts/fixtures/document-structure/`。

项目依赖新增锁定版本 `markdown-it@15.0.2` 与 `package-lock.json`；TypeScript 启用 `esModuleInterop` 以使用该依赖的默认导入。解析器遵循块 token 的 source line mapping，只有 level 0 的 heading token 成为 document section。采用成熟块解析器是为了正确区分列表、引用、HTML 和代码；参见 [markdown-it 官方文档](https://markdown-it.github.io/markdown-it/)。它不会被用于重新序列化 Markdown。

## 数据模型和范围契约

所有范围使用 **UTF-16 offset、左闭右开 `[start, end)`**，直接对应 JavaScript 字符串。

```ts
interface DocumentSection {
  id: string;
  headingText: string;
  headingLevel: number;
  headingStyle: 'atx' | 'setext';
  heading: SourceRange; // 完整 heading（Setext 含 underline），含已有行终止符
  title: SourceRange;   // 仅标题原文
  marker: SourceRange;  // ATX # 或 Setext underline
  body: SourceRange;    // heading 结束至下一个 heading 开始
  subtree: SourceRange;// 当前 heading 开始至下一个 level <= 当前的 heading
  parentId: string;
  children: readonly string[];
  sourcePath: string;
  line: number;
  depth: number;        // 实际树深度，与 heading level 分开
}
```

Document 另外持有 BOM、frontmatter、introduction 的独立范围。空文档及纯正文文档仍有虚拟 root；introduction 不是伪造的 heading，使用专用 `introduction` 编辑目标。

空白行属于它前面的 direct body。不能 trim 后再写回。原有 LF、CRLF、CR、混合行终止符、尾随空格、围栏和 block 内容保留；新插入的字符使用文件第一个行终止符，没有则用 LF。

必要的边界例外：EOF 没有行终止符时，插入标题或将最后一个 subtree 移到另一个标题之前，会补充一个行终止符，避免粘连。若 Setext 在新位置与前方正文合并成另一个标题等，验证会拒绝操作，而非猜测性地重排空白。

Setext 在 H1/H2 之间变更时仅改 underline 字符；移到 H3–H6 时仅将该 heading 转为 ATX，正文不变。多个源节点的 level 变更都会包含各自精确范围。

## 事务接口示例

```ts
const parser = new DocumentStructureParser();
const engine = new DocumentStructureTransactionService(parser);
const document = parser.parse(markdown, { sourcePath: 'Article.md' });

const transaction = engine.prepare(document, {
  type: 'move',
  nodeId: selectedSectionId,
  parentId: destinationSectionId,
  index: 0,
});

// transaction.before / after / edits / identityMap / selection / changeKind
// 这里没有文件写入。纯 body 修改的 changeKind 为 body，UI 不应因此重新 layout。
```

其他 operation 类型：`rename`、`insertSibling`、`insertChild`、`delete`、`moveBefore`、`moveAfter`、`promote`、`demote`、`updateBody`。`updateBody` 可携带相对正文 replacement 的 `cursorOffset`。

未被编辑的标题锚点通过 source copy 的 offset 映射保持 ID；移动/改写的标题由 Writer 明确返回 replacement 内的锚点。新 section 获得会话内新 ID，外部变更刷新后不使用标题/正文相似性猜测旧 ID。不能把会话 ID 跨重启当成持久标识。

## 安全提交与历史

```text
UI intent
  → prepare：验证当前模型、构造范围操作
  → Writer：校验 expectedText、生成候选原文和身份映射
  → Parser + Validator：检查目标结果与未涉及标题
  → Coordinator：验证会话版本、串行提交
  → Adapter.process：对最新文本与活跃编辑缓冲做同步检查
  → 成功后发布模型、selection 和历史
```

适配器 `process(path, transform)` 必须串行化该文件的读取、同步 callback 与写入；callback 抛错必须零写入。callback 接收 `text` 与 `editorsSynchronized`。同步状态未知时必须为 false。实际 Obsidian 接入优先评估公开 `Vault.process`，但其原子文件操作不等于保证所有 MarkdownView 尚未保存的编辑缓冲同步。

因此 **本阶段只用 MemoryHost 验证提交契约**。真实 Vault adapter 必须等原生编辑器试验明确同步行为后实现；不得把 `editorsSynchronized` 硬编码为 true。

提交使用完整字符串比较，不仅比较 hash 或 mtime。历史限制为 100 项及约 16M UTF-16 字符预算（不是精确堆内存大小）；超过预算会淘汰最旧记录，超大单项也可能不被保留。历史不跨重启持久化。

Undo/Redo 同样通过 adapter 的条件提交。历史记录的 view snapshot 在成功后恢复。外部改动刷新时清空旧历史，开始新会话 epoch；不尝试把全文快照覆盖到已变化文档。

IO 可能在写入前失败，也可能已经写入后才报错：两种情况都阻止继续事务并要求刷新。绝不“失败后自动写回旧全文”。自身 modify 的判定依据实际读取的文本，不忽略固定次数的事件；观察事件只分类，不发起写入。

## 明确的 Phase 1 限制

- 不含 UI、快捷键、拖拽、动画、删除确认框、真实保存或 Section Editor；不存在可打开的 Edit 模式。
- 原有只读 parser 尚未迁移到新 parser。后续接入前需要对 Native / Organic 标题差异做专门回归，不能无条件替换。
- 当前保守拒绝包含未闭合 frontmatter/代码围栏/数学块/注释、多行 Setext 标题、行内 `%%` 注释、非独立 `$$` 显示数学边界、从段落内部跨行开始的 HTML 注释的文档编辑。读取诊断仍可用。
- 此 parser 是明确测试过的 Markdown/Obsidian 子集，不宣称完整复刻 Obsidian 私有解析器。实际笔记集仍需集成验证。
- 遇到操作会改变非目标标题或导致块边界重新解释，取消整个事务。
- heading rename 不维护跨文件 heading links；后续 UI 应提供轻量提示。
- 内存正文事务尚未接入 CodeMirror Undo。正文输入与结构历史之间的映射、IME、未保存输入切换、多个 MarkdownView 同步，必须在编辑器试验中证明。
- 性能测量是 Node 纯引擎耗时，不代表 Obsidian 保存或渲染耗时。

## 测试与验收

运行 `npm run test:document`；`npm test` 包含现有 Native / Organic 回归和新引擎套件；`npm run build` 包含 TypeScript 检查。

测试覆盖：

- rename / sibling / child / delete leaf / delete subtree / promoteChildren / move / promote / demote / body / introduction；
- 精确预期原文、原 ID、原始正文、顺序、目标父子关系；
- 中文、emoji、重复空正文标题、跳级、H6、多个 H1、无 heading、正文前言、Setext；
- 列表、引用、callout、链接、图片、嵌入、HTML、注释、数学、代码围栏、围栏内伪标题；
- BOM、CRLF/LF/CR、混合换行、尾随空格、无末尾换行、长正文；
- 150 次确定性随机重排，验证每一个原 section 的 body 和 ID 保持；
- 操作序列逐次 Undo 再 Redo，每一步与原文快照完全一致；
- 外部写入、callback 前竞争、未保存编辑缓冲、两个 coordinator、乱序/重复事件、陈旧事务、写入前/后异常、提交返回异常、失败后恢复；
- 50 / 200 / 500 headings 的 parse + move + reparse + validation 基准。

本机一轮基准约为 7 / 40 / 82ms，对应约 29K / 124K / 315K UTF-16 字符。测试不设机器相关的硬阈值。

后续集成已完成：参见 [Writing Mode 使用说明](mind-map-writing-mode.md) 和 [编辑器接入验证](section-editor-feasibility.md)。纯引擎继续独立于 Organic UI 与 Obsidian IO。
