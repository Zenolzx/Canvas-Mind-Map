# 产品级差距审计 · Canvas Mind Map 1.1.1

审计基线：提交 `c77447d`（"全面优化交互界面/使用逻辑"），工作区另有未提交改动见附录 B。
审计方式：4 路并行源码深读（Native Canvas / Organic+写作内核 / Composer / 工程基建）＋ 全量构建与测试实跑。
本文件只记录结论与证据，未修改任何源码。

---

## 0. 摘要

**代码本身已经超过绝大多数 Obsidian 社区插件。** 数据层（原子写入、乐观并发、字节级换行保留）、排版引擎（纯函数、可复现、有像素/几何断言）、测试密度（44 个脚本、6 套真实浏览器用例）都达到了产品级水准。真正拦住"产品级"的不是架构，而是四件事：

| 维度 | 现状 | 差距 |
| --- | --- | --- |
| 数据安全 | Markdown 链路很强 | **DOCX 正文重写会静默丢书签/批注/脚注/域代码（唯一 P0）** |
| 发布工程 | 全手工上传、无 CHANGELOG | 版本会漂移、无法回滚、CI 不覆盖视觉基线 |
| 可访问性 | 鼠标/触控完整，键盘有洞 | 键盘无法到达卡片、焦点不可见、对比度不足 |
| 可维护性 | 模块边界清楚 | `ComposerView` 1360 行 10 个职责、i18n 双轨、无诊断能力 |

一句话结论：**修掉 1 个 P0 和 5 个 P1 数据安全项，再补齐发布流水线，它就够得上"产品级"；剩下的重构属于工程卫生，不阻断发布。**

---

## 1. 实测基线（可复现）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc -noEmit -skipLibCheck` | 通过，0 错误 |
| 生产构建 | `npm run build` | 通过，`main.js` ≈ **749 KB** 未压缩 |
| Lint | `npm run lint` | **0 error / 106 warning**（无 `--max-warnings`，CI 不会失败） |
| 单元/回归 | `npm run test:unit` | **24/24 套件全绿** |
| 浏览器 | `npm run test:browser` | **10/10 套件全绿**（Composer 5、写作 2、工作区 3） |
| 规模性能 | 内建基准 | 500 标题：解析+移动+校验 **117 ms**；Organic 布局 **9.2 ms**；50 标题布局 2.5 ms |
| 文档结构断言 | 内建 | 结构 34 项、事务 36 项、冲突 19 项、正文 9 项 |

规模：`src/` 60 个 TS 文件 **8485 行**；`styles.css` 69 KB / 1057 行；验证脚本 44 个。

**先说清楚哪些不是问题**（避免误判）：
- 移动端安全：`main.ts` 与 `src/**` 中 **0 处** `node:fs` / `path` / `Buffer` / `child_process` / `require`；`isDesktopOnly: false` 站得住。
- 安全面：全仓 **0 处** `innerHTML` / `insertAdjacentHTML` / `eval` / `new Function` / `fetch` / `requestUrl`；无遥测。
- 全部文件 IO 走 vault API，Markdown 提交用 `vault.process()` 做读-校验-写，而不是"读全文 → 覆盖写"。

---

## 2. P0 — 唯一的阻断项：DOCX 正文重写会静默丢内容

**证据**
- `src/formats/SourceFormats.ts:82-85` 的 `complex` 只覆盖 `drawing` / `object` / `fldChar` / `ins` / `del` / `hyperlink`。
- `src/formats/DocxEditor.ts:89-93` 的 `editableDocxBody` 追加了 `rPr` / `numPr` / `br` / `tab`。
- `w:bookmarkStart|bookmarkEnd`、`w:commentRangeStart/End`、`w:commentReference`、`w:footnoteReference`、`w:endnoteReference`、`w:fldSimple`、`w:instrText`、`w:smartTag` **全部被判为"简单段落"**，正文可编辑。
- 一旦编辑，`DocxEditor.ts:100-112` 会 `body.removeChild()` 掉本节所有直属段落，再用纯 `w:p/w:r/w:t` 重建。上述节点随之消失，**无提示、无只读门禁**。

**影响**：用户只是重打一段正文，目录域、交叉引用、批注、脚注引用、题注就可能从 `.docx` 中消失；Word 端可能提示"修复文档"。这是唯一需要立即修复的数据丢失级缺陷。

**修复方向**（小改动）
1. 把 `complex`（或新增 `rewriteSafe` 判定）扩展到上述节点，命中即整节只读；
2. 更彻底：正文编辑改为**段内 run 级替换**，保留段落壳与其中的非文本节点，而不是整段重建；
3. 加回归夹具：含书签/批注/脚注引用/域代码的 `.docx`，编辑后逐 part 断言未被删除。

---

## 3. P1 — 发布前应修

### 3.1 发布与分发（"产品"的门面）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-1 | 发布全手工，无 release 流水线、无 CHANGELOG、无版本同步校验 | `.github/` 只有 `verify.yml`；`main.js` 被 gitignore；1.0.3 的 release 正文自述"修复了 tag 与 manifest.json 版本不一致" | 版本漂移已经发生过一次；`manifest.version` 是 Obsidian 的更新键，错一次就发不出更新 |
| P1-2 | **tag 1.1.1 ≠ HEAD** | `git log 1.1.1..HEAD` = 4 个提交；已发布的 `main.js` 1,066,859 B（GitHub API）vs HEAD 构建 749,008 B | 插件市场默认渲染 `main` 分支 README：用户读到的是未发布行为，且已发布的包比 HEAD 大 30% |
| P1-3 | README 默认值与代码不符 | `README.md:221` 称"Follow Obsidian theme (default)"，`main.ts:44` 实际默认 `'ink'`；`README.md:224` 称"Dots (default)"，`main.ts:46` 实际默认 `'paper'`（tag 1.1.1 时两处都还对） | 新用户按文档预期配置，第一眼就是"和文档不一样" |
| P1-4 | 5 个"真机"套件从未被任何 npm 脚本引用 | `verify-formats-live`、`verify-formats-native-live`、`verify-pdf-edge-live`、`verify-workspace-live`、`verify-writing-live`（CDP 连 :9237 真实 Obsidian）；README:278 却称 `npm test` 跑"complete suite" | 唯一覆盖真实 DOCX/PDF/落盘的测试既不在 CI，也没文档 |
| P1-5 | CI 只有 ubuntu + Node 20 | `verify.yml`；视觉基线在 `baselines/environment.json` 记为 windows，`scripts/lib/visual.cjs:153-161` 在其他平台一律 SKIP | **CI 全绿 ≠ 有视觉回归覆盖**；失败产生的 `tmp/visual-diffs/` 随 runner 一起销毁 |
| P1-6 | 体积守卫在 CI 里被静默跳过 | `scripts/verify-design-tokens.cjs:133` 先 `fs.existsSync('main.js')`；`main.js` 被 gitignore，而 CI 在 `build` 之前跑 `test:unit` | 760 KB 预算与 base64 图片检查形同虚设（当前余量仅 3.7%） |

### 3.2 文档写入的数据安全

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-7 | 任意内联 `%%` / `$$` 让**整篇笔记**变成只读 | `DocumentStructureParser.ts:87-92` 对任何 `inline` token 命中即推诊断；`DocumentStructureTransactionService.ts:32` 的 `assertEditable` 首页拦截 | 正文里一句 `$$E=mc^2$$` 或 `%%todo%%` 之后，重命名/新增/移动/正文保存**全部**报 `unsupported-source`；此时输入的正文无法写入，只能靠恢复弹窗抢救 |
| P1-8 | 结构提交期间键入的字符被丢弃且不再自动保存 | `MindMapWritingController.execute` 先 `flush()`（未脏则立即返回，编辑器仍可输入）→ `await commit` → `bindEditor()` 重建编辑器；同一窗口的自动保存撞上 `busy` 抛错且不重排 | 用户"边等边打字"就丢一段；`SectionEditorController.ts:97` 的 `this.saved = this.raw` 还会把没写盘的文本标记成已保存 |
| P1-9 | Edit 模式可能用旧快照打开 | `OrganicMindMapView.ts:423-428` 先读源文件、必要时 `loadSource()`，却仍用旧的 `source.text` 构造控制器 | 协调器与磁盘永久不一致，第一次提交必然 `source-conflict` 并进入 blocked |
| P1-10 | DOCX 按标题回选、id 是位置 id | `DocxWritingController.ts:132-134` 用 `title ===` 找节点；id 来自 `docx:${block.index}`（`SourceFormats.ts:100`） | 遇到"Notes / 备注 / TODO"这类重复标题会绑定到**第一个**同名章节，下一次自动保存就写进别人家；撤销删除后 id 指向别的块 |
| P1-11 | DOCX 新建段落克隆 `pPr` 时带上 `sectPr` | `DocxEditor.ts:57-64` + `:111` | 多节文档每加一行就多一个分节符（页面设置错乱），删除时又会丢掉真正的分节符 |
| P1-12 | 未闭合 HTML 块里的新标题"写入成功但不显示" | `updateBody` 设 `allowNewHeadings = true`，`StructureValidator.ts:48` 过滤掉新 id；解析器只诊断 fence/`%%`/`$$`/注释，**不诊断 HTML 块** | 用户看到"保存成功"，导图里却没有这一节，笔记里多出一段被 HTML 吞掉的文字 |

### 3.3 Native Canvas 集成（HEAD 现状；工作区已有未提交重构，见附录 B）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-13 | 懒挂载在 `onLayoutReady` 后停止监听，且会误报 | `main.ts:181-193` 无条件 `stopWatchingPatches()`；`showMenu` 补丁还要求"已开画布且节点数 > 0" | 本次会话才第一次打开 Canvas → 补丁永不安装，却先弹"版本不兼容"提示 |
| P1-14 | 补丁可能在 unload 之后安装 | `onLayoutReady` 回调不属于插件生命周期；回调里的 `this.register(around(...))` 在卸载后不会执行卸载器 | 禁用插件后仍残留钩子 |
| P1-15 | 源笔记重命名后 Canvas 元数据不迁移 | `NativeCanvasModel.ts:23` 存 `source.file`；`main.ts:66-81` 只迁移 Organic/Composer 状态；`source()` 直接抛错 | 重命名笔记后"从原笔记刷新"永久失败，且无重新绑定入口 |
| P1-16 | 补丁钩子里的异常会冲进 Obsidian 渲染栈 | `CanvasMindmap.ts:77-82`、`86-113` 均未 try/catch（只有 `applyFocusLayout:592` 有） | 一次异常打断宿主渲染，而不是只坏插件 |
| P1-17 | `render()` 无脏检查，自动高度每帧重试 | 挂在被补丁替换的 `requestFrame` 上（`CanvasMindmap.ts:911-920`），每帧重建隐藏/淡化集合、每节点 `querySelector`、`getData()` 全量快照 | 平移/缩放越久越卡；放不下的节点每帧重调 `onResizeDblclick` |

### 3.4 Composer 交互与性能

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-18 | 每次渲染 O(N²) | `ComposerView.ts:255` 的 `node()` 每次全树 `entries(...).find(...)`，而 `render` 循环（`:323-363`）对每个节点调用它；`renderer.paint` 整组 `replaceChildren()`；`render()` 无条件重建整个 Inbox | 200 节点开始可感，500 节点明显掉帧 |
| P1-19 | 视口手势每次事件都整份落盘 | 滚轮 `:227-230` → `remember()` → `store.put(this.draft)`（整份深拷贝）+ `requestSaveLayout()`；分隔条拖动同样；`positionContext()` 每次读 `offsetWidth` 触发重排 | 单纯缩放/拖动就在持续写盘并强制布局，笔记本上更明显 |
| P1-20 | Tab 被 `key()` 吞掉 | `ComposerView.ts:201` 捕获阶段监听 → `:762` `Tab` 直接 `add(true)`/`promote` | 卡片、`+` 徽标、Todo 复选框**无法通过 Tab 到达**；Todo 只能鼠标勾选；`Enter` 也走 `add()`，渲染器里"激活"的分支成了死代码 |
| P1-21 | 折叠后选择残留在隐藏分支 | `:310` 翻转 `collapsed` 后不收敛选择；`render` 只画可见节点但 `draft.selection` 仍是隐藏节点 | 删除/拖动/方向键作用在看不见的节点上，方向键 `index` 变 `-1` |
| P1-22 | 内联编辑期间自动保存被挂起 | `remember()` 在 `editingActive` 时直接 return（`:267-269`），而 `add()/groupSelection/rename` 整个事务都置位 | 重命名中途崩溃/退出，丢的不只是标题，还有刚插入的节点 |
| P1-23 | 撤销粒度不可控 | `ComposerHistory` 整份克隆；800 ms 合并窗口被每次按键重置（`:191`） | 一次 Ctrl+Z 可能抹掉整段输入；而选择/布局/面板宽度这些视图状态又混进内容快照，撤销会莫名回退布局 |
| P1-24 | 单体 View | `ComposerView.ts` 1360 行，同时负责：壳层构建、渲染管线、视口/度量、Inbox、内联编辑、结构命令、键盘、拖拽、Sketch、菜单、导出与草稿库 | 任何一处改动都要通读全文；新人上手成本高；与已有良好的 Store/Model 分层不匹配 |

### 3.5 可访问性

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1-25 | Organic 非根节点键盘焦点不可见 | `styles.css:182` 对 `[role="link"]` 设 `outline: none`，但只有 `.is-root` 有 `:focus-visible` 替代（`:183-184`） | 键盘用户 Tab 到普通标题时完全看不出焦点在哪 |
| P1-26 | Composer 舞台移除焦点指示 | `styles.css:974` `.cmm-composer-stage { outline: none }`，卡片焦点只靠 1px 命中框描边 | 同上；自由便签/批注是不可聚焦的 `<g>`，SVG 无无障碍名称 |
| P1-27 | Sketch 调色板两色低于 3:1 | `src/design/palette.ts:25-28`：olive `#989e70` = 2.71:1，clay `#b98772` = 2.98:1（对纸面 `#fffaf0`） | 作为结构描边时低视力用户难以分辨；其余颜色达标 |

---

## 4. P2 — 清单（按主题，择机处理）

**数据与持久化**
- `PluginDataStore.save()` 每次 `JSON.parse(JSON.stringify(整个快照))`，保存一份草稿也会序列化全部草稿与设置；大批草稿时是主线程尖峰。
- `ComposerStore.put()` 每次编辑整份 `clone(draft)`；建议按 draftId 做脏标记 + 增量序列化。
- `schemaVersion: 1` 是字面量类型，`normalizeDraft` 对其他版本直接抛错，`ComposerStore` 把失败草稿塞进 `unsupported` 后再序列化回去，但**从不提示、无法迁移**（`ComposerModel.ts:21,42`、`ComposerStore.ts:26-32`）。
- 同一草稿开两个标签页时 `store.put` 无 revision 校验，后写覆盖先写（`ComposerStore.ts:47-52`）。
- DOCX 读-改-写非原子：`readBinary` → FNV-1a 32 位指纹 → `zipSync`（同步，阻塞 UI）→ 再读再比 → `modifyBinary`（`DocxEditor.ts:186-197`）；二进制没有 `vault.process` 等价物。
- DOCX 撤销栈是无界 `ArrayBuffer[]`（`DocxWritingController.ts:14-15`），与 Markdown 侧 100 条 / 16 MB 的有界历史不一致。
- PDF 导入无页数上限、无超时、无取消、无逐页容错；失败会清空可用模型（`SourceFormats.ts:109-152`、`OrganicMindMapView.ts:788-797`）。
- 手动刷新也会清空 undo 历史且无提示（`DocumentChangeCoordinator.refresh():59-69`）。
- 插件卸载/退出不 flush 650 ms 编辑器防抖（`SectionEditorController.ts:70`）。

**边界正确性**
- 身份重绑只要求"新侧唯一"（`OrganicNodeIdentity.ts:24-25`），旧侧重名时会绑到别的章节，导致折叠/配色/选中错位。
- View 与 Edit 解析器不一致：`HeadingParser` 只跳 YAML/围栏，Edit 还屏蔽 HTML/`%%`/`$$` → View 里的"幽灵节点"。
- 混合换行：`SectionTextBuffer.ts:60` 把插入的 LF 改写成 `defaultEol`，CRLF 文件里的 LF 段会混入 CRLF；含 CR/CRLF 且存在原生编辑器时直接拒绝写入（`ObsidianDocumentHost.ts:110,149`），只有 Notice。
- DOCX 压缩包往返未对 Word 校验：只断言图片与表格存活，未逐 part 字节比对。
- Composer 导出后光标定位：列表项节点没有 offset，回退到父标题（`ComposerView.ts:1280-1281`）。
- 外观选择器在 fallback 路径传 `async () => {}` 作为保存（`ComposerView.ts:795`）→ Apply 不落盘；主入口传了真实回调，属隐藏分支。
- 字体度量缓存不随外观/字形切换失效（`ComposerView.ts:373-385`）。
- `ObsidianCompat.d.ts` 里的 `onHistoryBack` **没有任何调用点**，是死声明。

**国际化与文案**
- 源码以中文为 key（`i18n.ts`）＋ `ct()` 英文→中文双轨，两套机制并存；新增文案容易只补一边。
- 硬编码中文残留：`ObsidianDocumentHost.ts:39` 的 Notice、`NativeCanvasRenderer.ts:173` 的 `<title>`；`main.ts:111-116` 的命令名硬编码英文。
- `main.ts:267` 用已弃用的 `PluginSettingTab.display()`（1.13 起），且未实现 `getSettingDefinitions()` → **设置项不会进入 Obsidian 1.13+ 的设置搜索**。
- `CanvasMindmap.ts:901` 使用已弃用的 `setWarning`（应改 `setDestructive`）。

**工具链**
- `eslint.config.mjs` 把 11 条规则降为 warn，`lint` 没有 `--max-warnings 0`；tsconfig 无 `noUnusedLocals`/`noUnusedParameters`/`exactOptionalPropertyTypes`，target ES6 与 esbuild 的 es2018 不一致（`Object.fromEntries` 只是靠 `@types/node` 注入的 lib 才通过）。
- 44 个验证脚本是手写 `&&` 链，无测试框架；失败即中断，看不到全貌，新人也没有"加一个测试"的入口文档。
- 基线 PNG 占仓库 ~2.6 MB / 总计 3.9 MB，且只在一个平台上有效。

**性能（已知量级）**
- 每次结构编辑会 `prepare` 两次（控制器一次 + `commit` 内一次），每次都跑 `writer.apply` + 全量 `parser.parse` + 校验；拖拽过程中每次换目标再解析一次 → 500 标题笔记一次拖拽 3–4 次全量解析。
- `StructureHistory.record` 每次 push 全量 `reduce` 统计体积（`StructureHistory.ts:30`）。
- 拖拽反馈每帧遍历全部节点做 `getBoundingClientRect` + `elementFromPoint`，并用整份草稿克隆来校验落点（`ComposerView.ts:978-1043`）。
- Sketch 拖拽阈值按世界坐标计算，缩放 2× 时只有 2.5 屏幕像素（`ComposerView.ts:927-928`）。

**分发包**
- `@xmldom/xmldom` ≈148 KB 仅服务 DOCX，却常驻启动包；markdown-it 用的是全量 commonmark preset。两者合计约占 750 KB 的三分之一，可懒加载。

---

## 5. 产品化差距（不是 bug，是"产品"该有的东西）

1. **发布流水线**：tag → 校验 `tag == manifest.version == package.json.version` → 构建 → 上传恰好三个资产（`main.js` / `manifest.json` / `styles.css`）。附一页"如何回滚"。数据格式向后兼容（各 Store 都做了版本门禁），回滚是安全的。
2. **CHANGELOG**：现在只有 `docs/release-1.1.0.md`、`docs/release-1.1.1.md`。生成 `CHANGELOG.md` 并让 release 正文取自它。
3. **支持面**：没有诊断命令、没有调试模式、没有统一日志前缀。建议加"复制诊断信息"（插件/Obsidian 版本、补丁挂载 landed/total、`data.json` 各段大小、最近 50 条错误）。隐私上保持零遥测，但要让用户**能一键交回证据**。
4. **上手与文档**：`README.md` 290 行、**0 张截图/GIF**（全仓文档也是 0 张）。插件市场页面的转化几乎完全取决于首屏图。建议补 4 张：Native 导图、Organic View/Edit、Composer、Sketch；再加一段 30 秒快速开始。
5. **设置可用性**：设置项分散在两个 render 函数里，无搜索、无"恢复默认"。迁移到 `getSettingDefinitions()` 可一并解决 1.13+ 的设置搜索与 deprecated 警告。
6. **数据模型演进**：`data.json` 顶层没有全局 `schemaVersion`，三个 Store 各自版本化。现在够用，但第一次需要跨 Store 迁移（例如重命名 `organicState` 结构）时会没有入口。建议加顶层版本 + 迁移链。
7. **移动端声明**：`isDesktopOnly: false` 且确实没有 Node API，但没有一条移动端测试或验证清单。要么补一份手动验证清单（触控拖拽、长按菜单、软键盘、分屏窄宽），要么把 manifest 改成 desktop-only 以降低承诺。
8. **无障碍目标**：目前是"顺手做了"（`aria-expanded`、`prefers-reduced-motion`、部分 `focus-visible`）。产品级建议明确 WCAG 2.1 AA 为验收线：焦点可见、全键盘可达、非文本对比度 ≥ 3:1。
9. **国际化策略**：EN + zh-CN 足够，但"中文当 key"的写法在国际化扩到第三种语言时会成为负债。不必现在重构，但新代码应统一走 `ct()` 一侧。

---

## 6. 路线图（含验收标准）

### 阶段 0 · 止血（0.5–1 天）
- 修 P0：DOCX `complex`/`rewriteSafe` 判定；补书签/批注/脚注/域代码夹具。
- 验收：新增夹具下 `npm run test:unit` 绿；手工用含批注的 `.docx` 编辑一段正文，`word/document.xml` 中 `w:bookmarkStart`/`w:commentReference` 仍在。

### 阶段 1 · 发 1.1.2（1 天）
- `scripts/verify-version-sync.cjs`（读 `manifest.json` / `package.json` / `git tag`）并入 `test:unit`。
- `.github/workflows/release.yml`（tag 触发，校验 → 构建 → 三个资产）。
- `CHANGELOG.md`；修正 `README.md:221/224` 的默认值；补"回滚"段落。
- 把体积/图片守卫挪到 `build` 之后执行。
- 验收：`git tag 1.1.2 && git push --tags` 后 release 页恰好三资产；`npm run test:unit` 在无 `main.js` 的干净检出下**能失败**（证明守卫真的跑了）。

### 阶段 2 · 写作安全（3–5 天）
- P1-7 内联 `%%`/`$$`：改为"该节只读"或"仅在不闭合时诊断"。
- P1-8 提交窗口键入：`commit` 后重查 `editor.dirty` 再 `bindEditor`；`flush` 用提交时的快照赋值。
- P1-9 用 `this.sourceText` 构造控制器。
- P1-10/11 DOCX 选择映射与 `sectPr` 处理。
- P1-12 增加未闭合 HTML 块诊断。
- 验收：为每条加一条回归断言；手工场景"边提交边打字""重复标题 DOCX""`$$` 行内公式"。

### 阶段 3 · 可达性与性能（约 1 周）
- 键盘：`key()` 只在 `event.target === stage` 时接管；卡片 roving tabindex + Enter/Space 激活；Tab 不再被吞。
- 焦点：`[role=link]` 统一 `:focus-visible` 描边（非仅根节点）；SVG 命名；`aria-tree` 化。
- 折叠后收敛选择；Inbox 仅在输入变化时重绘；`id → entry` 渲染期构建一次。
- 视口手势改为 rAF 合并 + 手势结束落盘。
- 调色板两色提对比度到 ≥ 3:1。
- 验收：只用键盘完成"新建 → 改名 → 加子节点 → 改类型 → 折回 → 导出"；`ComposerView` 500 节点滚轮/拖拽无长任务 > 50 ms。

### 阶段 4 · 结构重构（1–2 周，不阻断发布）
- 拆 `ComposerView`：`ComposerCanvasPresenter`（渲染/度量/视口）、`ComposerChromeBuilder`、`ComposerInbox`、`ComposerInlineEditor`、`ComposerDragController`、`ComposerSketchController`、`ComposerCommandRouter`、`ComposerExportDialog`、`ComposerDraftLibrary`；`ComposerView` 收敛到 ~250 行编排层。
- 历史改为命令/增量日志，视图状态（layout/panel/viewport/selection）移出内容快照。
- 草稿版本注册表 + 迁移链；`unsupported` 草稿给出可见恢复入口。
- 验收：`ComposerView.ts` < 300 行；现有 `verify-composer-*` 全绿且无需改动断言。

### 并行小项（随时可做）
- 删除死声明 `ObsidianCompat.d.ts` 的 `onHistoryBack`。
- `setWarning` → `setDestructive`；`PluginSettingTab` → `getSettingDefinitions()`（可同时把 `minAppVersion` 提到 1.13）。
- `lint` 加 `--max-warnings 0`（先清 106 条，或按目录逐步收紧）。
- CI 加 `windows-latest` 腿 + `actions/upload-artifact`（失败时上传 `tmp/visual-diffs/`）。
- README 补截图；加 `TESTING.md` 说明"怎么加一条 verify 脚本"。

---

## 附录 A：值得保留的工程资产（不要为了重构而重构）

- **Markdown 写入是纯区间拼接**：`MarkdownStructureWriter` 用 `expectedText` 校验、有序不重叠检查、锚点/身份映射，未触碰的字节从不重新序列化。
- **提交前重算**：`DocumentChangeCoordinator.commit()` 用 `this.current` 重新 `prepare` 并比对候选文本，调用方传入的"已变异计划"无法绕过校验。
- **校验的是意图，不是可解析性**：逐节标题/层级/父子/顺序、全文覆盖、BOM/frontmatter 不可变。
- **Obsidian 边界处理是同类插件里的上限**：等待在途原生保存、提交租约内拦截 `MarkdownView.save`、在 `vault.process` 回调里复查实时缓冲、CR/CRLF + 原生编辑器时拒绝写入、IO 失败后读证据而不是回滚。
- **字节级 EOL/BOM 保留**：`sourceText` + `insertionEol` + 二分偏移映射，LF/CRLF/CR+BOM 都有断言。
- **排版引擎是纯函数**，障碍避让用精确禁入区间而非随机抖动，几何可复现并有断言。
- **模糊输入一律 fail-closed**：未闭合围栏、`%%`/`$$` 块、未闭合 frontmatter、多行 Setext，都给出可操作提示。
- **测试是真的在跑**：`verify-*` 用 esbuild 现场打包 TS 后执行并断言行为，不是源码字符串匹配；浏览器套件覆盖真实拖拽、IME、撤销、落盘与截图比对。
- **视觉基线是平台作用域的**，跨平台是"响亮的 SKIP"而不是假回归，并有 `CMM_REQUIRE_VISUAL` 强制开关。
- 窗口作用域定时器（`design/timers.ts`）、有序写入器（`PluginDataStore`）、草稿恢复弹窗、零遥测零动态代码。

---

## 附录 B：工作区未提交改动（审计期间出现，非本审计写入）

审计过程中工作区出现了 6 处未提交改动，时间戳 2026-10-22 14:01，我没有写入任何文件：

```
 M Canvas.d.ts
 M README.md
 M README.zh-CN.md
 M main.ts
 M src/CanvasMindmap.ts
?? src/native/DeferredCanvasIntegration.ts
```

内容概要：把"按原型深度打补丁 + 在 layout-ready 后停止监听"改成 `watchCanvasIntegration()`（监听 `layout-change` / `active-leaf-change` / `file-open` / `window-open` 并重试）＋ 逐个 canvas 实例 `around`；右键菜单从 `showMenu` 原型补丁改为 `workspace.trigger('canvas:node-menu')`；同步改写 README 里"依赖 Enhanced Canvas"的表述。

我的核查结论：
- 类型检查通过；`canvas:node-menu` **确实存在于本机 Obsidian 1.13.7**（`obsidian.asar` 中可见 `workspace.trigger("canvas:node-menu", …)`），但**不在** `node_modules/obsidian@1.13.1` 的公开 typings 里，因此 `Canvas.d.ts` 需要自行声明。
- **风险**：`manifest.json` 仍是 `minAppVersion: 1.7.7`；若该事件晚于 1.7.7 引入，老版本上"画布右键 → 导图菜单"会静默消失。建议保留 `showMenu` 兜底，或把 `minAppVersion` 提到确认过的版本。
- 该改动正面解决了 P1-13 与 P1-14（补丁不再因持续监听而漏装，卸载后也不会再安装）；P1-15（重命名后 `source.file` 不迁移）、P1-16（钩子内的 `render()` 异常仍未包 try/catch）、P1-17（每帧渲染）均未覆盖。

如果这批改动属于你在途的工作，请以它为准；我可以基于这个状态复评，而不是基于 HEAD。
