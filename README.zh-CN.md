<div align="right">

**简体中文** | [English](README.md)

</div>

# Canvas Mind Map

**先用脑图组织想法，再生成 Markdown，继续写作。**

Canvas Mind Map 提供三个独立工作空间：**Native Canvas** 使用原生卡片，**Organic** 阅读和编辑已有 Markdown，**Composer** 从空白脑图创建新文档。Organic 和 Composer 复用曲线分支渲染与布局，但各自的数据源和保存方式不同。

**已上架 Obsidian 第三方插件市场。** [打开插件页面](https://obsidian.md/plugins?id=canvas-mind-map) · [下载 Release](https://github.com/Zenolzx/Canvas-Mind-Map/releases)。

本 README 介绍当前源码的功能，包括 Composer 思考与写作工具（路线图 v1.1 / v1.2）；已发布安装包的功能范围以对应的 [Release 说明](https://github.com/Zenolzx/Canvas-Mind-Map/releases)为准。

## 选择 Mode

| 模式 | 数据源与保存 | 主要用途 | 入口 |
| --- | --- | --- | --- |
| Native Canvas | 原生 Canvas 节点和连线 | 七种布局、自由移动卡片、保留 Canvas 交互 | Canvas 笔记卡片或文本卡片上的「生成可折叠思维导图」 |
| Organic | 已有 `.md` 文件；**Edit** 直接写回该文件 | **View** 阅读和导航；**Edit** 修改标题与章节直属正文 | Markdown 文件右键 → **以 Organic 模式打开笔记**，或同名命令 |
| Composer | 插件 Draft；点击 **Create Note** 才创建 `.md` | 从空白或模板开始，收集想法、整理结构、填写正文 | Ribbon / 命令 **New Mind Map Document**；文件夹右键 **New Mind Map Document here** |

从零写新文档使用下方的 **Composer**；修改已有笔记使用 **Organic Edit**；制作可移动卡片使用 **Native Canvas 快速开始**。**View / Edit** 是 Organic 内部状态；Native 的「仅标题 / 正文」控制卡片内容，不是新的顶层 Mode。

```text
New Mind Map Document → Composer 草稿 → Create Note → Organic Edit ⇄ View
```

### Organic 阅读与导航

Organic 在独立标签页打开，不转换或覆盖已有 `.canvas`。View 模式下，单个顶层标题成为中心，多个顶层标题使用笔记名作为中心；无标题笔记显示笔记名。初始显示中心（depth=0）及下面两层标题。点击标题跳转到原笔记对应行，重复标题也能定位；点击标题下的 ＋/− 展开或收起子树。折叠时保留分支颜色、左右归属与顺序，并保持操作标题的屏幕位置。

拖动空白处平移，滚轮围绕鼠标缩放，工具栏可缩放或「适应窗口」。聚焦背景后也可使用方向键、`+`/`-` 和 `0`。标题和折叠按钮支持键盘聚焦；Enter 打开标题，Enter/空格切换折叠。

Organic 在原笔记变化后自动刷新（500ms 防抖），保留可可靠匹配的节点状态与视角；「刷新」仍可手动执行。节点身份结合章节内容、标题路径与已匹配父节点恢复，存在歧义时放弃对应状态。跳转原文前仍检查快照，防止跳错行。

工具栏「搜索标题」或 Organic 内的 Ctrl/Cmd+F 可搜索包括折叠后代在内的所有标题；Enter / Shift+Enter 切换结果，Esc 清除搜索。右键标题可「聚焦当前分支」或「阅读此分支」：Focus 保留子树和祖先路径，Reading 使用 ↑/↓ 按 Markdown 顺序阅读并平滑跟随。搜索 Focus 范围外的结果时临时暂停 Focus，清除搜索后恢复。搜索与阅读的临时展开不会覆盖手动折叠。

布局下拉框提供 **Organic Radial / Organic Horizontal / Compact Organic**。展开与折叠动画遵守系统 reduced motion 设置。「导出 → SVG / PNG」导出当前可见结构，保留 Focus 与折叠范围，保存到原笔记所在目录，同名文件自动加编号。PNG 默认 2x，设置可选 1x/2x/3x；超过浏览器画布尺寸限制时会提示降低倍率或使用 SVG。

折叠、缩放、视角中心、Focus、Reading 位置、选择与布局按原笔记路径保存到插件数据。文件重命名和移动会迁移状态，删除文件会清理状态。多个标签页独立交互，以最近用户实际操作的状态为准。设置包含自动刷新、记住/重置状态、默认布局、动画/时长和 PNG 倍率。**View** 用于浏览，**Edit** 将修改写回原 Markdown，并提供独立的编辑历史。

## Composer：从脑图到新文档

### 开始构思与写作

1. 点击 Ribbon 或命令面板中的 **New Mind Map Document**。文件夹右键的 **New Mind Map Document here** 会记住该目录，作为首次创建笔记时的默认位置。
2. 双击中心节点 **Untitled** 或按 F2 改名。它表示文档名称，不会立即创建文件，也不默认成为 Markdown H1。
3. Enter 新建章节。输入标题后，Enter 确认并开始下一个同级节点，Tab 确认并开始子节点，Esc 取消当前未完成节点。F2 修改已有节点时，Enter 只确认改名。
4. 选中节点，在右侧填写**直属正文**，不包含后代正文。中心节点的正文是文档前言。**Body: auto / show / hide** 控制面板显示，拖动分隔线调整宽度。
5. 点击 **Create Note**，检查导出选项和 Markdown 预览，选择文件名与目录。创建成功后，当前 Tab 进入 **Organic Edit**。

Root 名称只提供文件名建议，两者可以分别修改。**Document name only** 将一级子节点导出为 H1；**Use root as H1** 将 Root 导出为 H1，子节点从 H2 开始。切换 Root 行为、拖动和缩进都会检查整个子树，阻止超过 H6。章节标题应在脑图中创建，不要写入 Heading 节点的正文。

### 整理想法

- **Ctrl/Cmd+单击** 添加或移除选择；**Shift+单击** 选择可见范围。正文编辑针对当前主选中节点；类型修改作用于所有选中的非 Root 节点。
- 右键 → **Create → Create parent from selection** 为同一父节点下的选中节点创建共同父节点，保留顺序、正文、后代和 metadata。
- 拖动一个或多个选中分支，使用 **Before / Make child / After** 预览决定位置。形成环或超深的落点不可提交。键盘提升、降级、排序要求选择连续的同级节点；批量删除可删除整个分支或保留子节点。一次批量操作对应一次撤销。
- 打开 **Unsorted Ideas**，通过 **Add idea** 收集还没确定位置的想法。可点击 **Move selection here**、在抽屉与脑图之间拖动，或使用 **Structure → Move to document root / Move to Unsorted Ideas**。
- 正文面板或节点菜单可切换 **Heading / Idea / Todo**。Idea 使用 `?` 前缀和虚线外框；Todo 使用复选框标识，可点击 **Mark complete / incomplete** 标记完成状态。

### 搜索与聚焦

**Search** 或脑图获得焦点时的 Ctrl/Cmd+F 支持 **Titles / Bodies / Everything**，包含折叠后代和待整理区。Enter / Shift+Enter 切换结果，Esc 关闭搜索。**Focus** 只显示当前分支及祖先路径，**Show overview** 恢复全图。搜索可以临时显示 Focus 外的结果，不修改已保存的折叠状态。节点菜单还提供 **Expand one level / Expand branch / Collapse branch / Show to level…**。

### 写作工具

命令 **New Composer from template** 或 **⋯ → New from template** 提供 Blank、Essay、Project Plan、Meeting Notes、Research Notes、Course Notes。每次创建独立 Draft。**⋯ → Duplicate draft** 复制正文、节点类型、属性和待整理想法，可用来复用自己的文档结构。

**⋯ → Document properties** 编辑 YAML Frontmatter，不包含 `---` 分隔线；必须是有效的 YAML mapping，导出时放在前言之前。**⋯ → Copy outline** 复制 Markdown 列表大纲，包含 Todo 复选框和 Unsorted Ideas 分组。状态栏显示章节、Idea、Todo 完成数、待整理节点、字词统计及草稿保存状态。

### 导出与保存

**Create Note** 验证结构和文件名，选择 Vault 中已有目录，不覆盖同名文件。导出为空时需要确认。**Preview Markdown** 显示本次创建实际使用的 Markdown 内容。

| 内容 | 导出规则 |
| --- | --- |
| Heading | 标题、直属正文、子节点 |
| Idea | 必须选择 **Convert to headings / Convert to bullet items / Exclude idea branches**；也可 **Review individually**，逐个修改节点类型后再创建 |
| Todo | `- [ ]` 或 `- [x]` 列表项 |
| 列表 / Todo 分支 | 后代全部作为嵌套列表，包括原来为 Heading 类型的后代；正文保留在相应列表项内 |
| Unsorted Ideas | 必须选择 **Append to document** 或 **Exclude and keep draft** |

排除 Idea 时排除其整个分支。只要有内容被排除，创建笔记后仍保留完整 Draft；没有排除内容时，只有 Organic Edit 初始化成功后才删除 Draft。选中和折叠状态按生成位置传递；导出为列表的节点会定位到最近的已导出标题，或文档前言。

**Draft saved** 只表示插件草稿已保存，不代表存在 Markdown 文件。修改后 500ms 自动保存，可关闭后恢复。**Restore Composer Draft** 提供打开、Rename、Duplicate、Delete 和恢复数据导入；删除已打开草稿时，先关闭对应 Tab，或在该 Tab 使用 **Discard draft**。保存失败会提供重试与可复制的恢复数据。撤销历史属于当前编辑 Session，重新打开后不恢复旧历史。

### Composer 快捷键

| 操作 | 行为 |
| --- | --- |
| F2 / 双击 | 重命名文档或节点 |
| Enter / Tab | 新建同级 / 子节点；输入新节点时支持连续创建 |
| Shift+Tab / Alt+← | 提升 |
| Alt+→ | 变成前一同级节点的子节点 |
| Alt+↑ / Alt+↓ | 同级排序 |
| 方向键 | 导航可见节点、父节点或首个子节点 |
| Delete | 删除选择；分支可选择保留子节点 |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | 撤销 / 重做，覆盖正文和批量修改 |
| Ctrl/Cmd+Enter | 聚焦直属正文；Esc 返回脑图 |
| Ctrl/Cmd+F | 脑图聚焦时打开 Composer 搜索 |
| 拖背景 / 滚轮 / `+` / `-` / `0` | 平移 / 缩放 / 缩放 / 适应画布 |

布局支持 Horizontal / Radial / Compact，Composer 独立记住默认布局和面板宽度。当前仍以文档树为核心；路线图 v2 中的非树关系、共享想法与自由知识网络尚未实现。

## Edit / 思维导图写作模式

1. 右键 Markdown 笔记，选择 **以 Organic 模式打开笔记**；也可以打开笔记后执行同名命令。
2. 点击 Organic 顶部的 **Edit**，进入写作模式。
3. 单击标题选择章节，双击或按 **F2** 修改标题；按 **Enter** 新建同级章节，按 **Tab** 新建子章节。
4. 在右侧编辑当前标题的**直属正文**，不包含子章节内容。输入自动保存到同一个 `.md` 文件。
5. 切回 **View**，继续浏览导图或跳转到原笔记。

拖动标题可移动整个章节，包括正文和后代。落点提供 **Before / Make child / After**（之前 / 作为子章节 / 之后）三个区域及预览。也可通过键盘提升、降级或调整章节顺序；形成循环或超过 H6 的操作会被拒绝。删除时可选择删除整个子树，或保留正文并提升子章节。

### 编辑快捷键

以下快捷键在**脑图获得焦点时**生效：

| 按键 | 操作 |
| --- | --- |
| 双击 / F2 | 内联修改标题 |
| Enter / Tab | 新建同级 / 子章节 |
| Shift+Tab 或 Alt+← | 提升章节 |
| Alt+→ | 降为前一同级章节的子章节 |
| Alt+↑ / Alt+↓ | 向前 / 向后调整同级章节顺序 |
| ↑ / ↓ / ← / → | 选择前一同级 / 后一同级 / 父章节 / 第一个子章节 |
| Delete | 打开删除确认框 |
| Ctrl/Cmd+Enter | 聚焦右侧正文编辑器 |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | 撤销 / 重做结构编辑 |

连续创建标题时，**Enter** 确认并继续创建同级标题，**Tab** 确认并创建子标题，**Esc** 取消草稿。在正文编辑器内，撤销/重做针对文字编辑，**Esc** 返回脑图。正文支持 Markdown 高亮，以及 Ctrl/Cmd+B/I/K 加粗、斜体和插入链接。

拖动分栏边界调整正文面板宽度，也可通过「更多」菜单隐藏正文。文件名根节点可编辑第一个标题之前的引言、添加顶层章节，不会重命名文件。重开时可恢复模式与分栏状态；撤销历史仅保留在当前会话中。

编辑直接写回原 Markdown。若其他编辑页存在未保存修改，请先保存再刷新导图。外部刷新不会覆盖未保存的正文草稿；关闭时保存失败会提供草稿恢复窗口。修改标题不会自动更新其他笔记中的标题链接。冲突处理及当前编辑器、换行符限制详见 [Writing Mode 使用说明](docs/mind-map-writing-mode.md)。

以下原有功能和操作说明适用于 **Native Canvas**，其中「仅标题 / 含正文」属于内容选项，不是 Rendering Mode。

## 功能亮点

- **一键生成**：从 Markdown 笔记卡片或包含标题的文本卡片生成导图，支持 H1–H6 标题。
- **两种内容模式**：仅标题模式适合梳理结构；含正文模式适合边看结构边阅读章节。
- **七种布局**：中心向四周、左右双侧、上下双侧，以及向右、向左、向下、向上的单向树。生成后可随时切换。
- **中英文界面**：可自动跟随 Obsidian，也可在插件设置中手动选择英语或简体中文。
- **逐层展开**：收起整个分支、展开下一级，或显示到指定层级，让复杂笔记保持清晰。
- **分支阅读**：右键聚焦当前分支，将当前可见后代临时排成紧凑的局部布局，同时固定聚焦卡片和祖先路径；顶部可切换隐藏、淡化和紧凑布局，退出后恢复原位置、折叠状态、选择与视角。
- **搜索定位**：搜索包含折叠节点的标题和章节路径，选中结果后自动展开祖先路径并定位。右键「查看思维导图全貌」用于结构导航。
- **命令与快捷键**：生成、折叠、层级、布局、聚焦、全貌、搜索、刷新和外观操作均可通过命令面板执行，并可在 Obsidian 中自行绑定快捷键。
- **链接原笔记**：笔记来源的标题卡片链接到对应章节；文本来源直接显示标题。
- **按层设置外观**：自定义中心和各层卡片的宽度、高度、颜色与自动高度，也可单独调整节点。
- **从原文刷新**：笔记结构变化后更新导图，保留可匹配节点的手动编辑；涉及移除节点时先确认。
- **原生 Canvas 体验**：保留卡片编辑、额外连线、撤销与重做。导图随画布保存，停用插件后卡片仍然保留。

## 安装

### 方法一：通过 Obsidian 第三方插件市场安装（推荐）

1. 打开 Obsidian，进入「设置 → 第三方插件」。
2. 点击「浏览」，在插件市场中搜索 **Canvas Mind Map**。
3. 点击「安装」，安装完成后点击「启用」即可使用。

### 方法二：手动安装

1. 从 [GitHub Releases](https://github.com/Zenolzx/Canvas-Mind-Map/releases) 下载同一版本的 `main.js`、`manifest.json` 和 `styles.css` 三个文件。

2. 打开你的 Obsidian 笔记库目录，并进入 `.obsidian/plugins/`。在其中创建名为 `canvas-mind-map` 的文件夹：

   ```text
   .obsidian/plugins/canvas-mind-map/
   ```

3. 将 `main.js`、`manifest.json` 和 `styles.css` 放入该文件夹中。最终目录结构应类似：

   ```text
   .obsidian/
   └── plugins/
       └── canvas-mind-map/
           ├── main.js
           ├── manifest.json
           └── styles.css
   ```

4. 重新加载 Obsidian，进入「设置 → 第三方插件」，找到 **Canvas Mind Map** 并启用。

> 如果插件没有出现在列表中，请确认三个文件均位于 `.obsidian/plugins/canvas-mind-map/` 目录下，并尝试重新启动 Obsidian。

需要 Obsidian **1.7.7 或更高版本**。

### 从 Enhanced Canvas 迁移

如果此前使用 Enhanced Canvas 内置的思维导图功能，请先停用 Enhanced Canvas，再启用 Canvas Mind Map，不要同时运行两套实现。旧导图元数据目前不兼容，建议先备份相关 `.canvas` 文件，再用本插件重新生成导图。

## Native Canvas 快速开始

1. 打开一个 Canvas，放入 Markdown 笔记，或创建含有标题的文本卡片。
2. 选中卡片，右键选择 **生成可折叠思维导图**。也可以通过命令面板执行同名命令。
3. 选择「仅标题」或「含正文」，再选择布局，点击「生成」。插件会记住上次的选择。
4. 点击节点下方的 **＋ / −** 展开或收起分支。

首次默认使用「仅标题 + 左右双侧」，之后记住你的选择，生成后显示到第 2 层。只有一个顶层标题时，该标题会成为中心；多个顶层标题则围绕笔记中心展开。生成会替换来源卡片，并将原有外部连线接到新中心，可通过撤销恢复。

### 调整导图

在导图节点上打开右键菜单，可以：

- **返回中心 / 聚焦当前分支 / 查看全貌 / 搜索标题**，执行结构导航。
- **展开 / 折叠**，包含展开下一级、收起分支和显示到指定层级。
- **布局**，包含切换布局和重新排列。
- **外观**，包含节点外观、层级模板、分支样式和恢复节点模板。
- **从原笔记刷新**，同步标题结构变化。所有原有命令面板入口继续保留。

每棵导图独立保存布局。七种布局都按实际卡片尺寸组织完整子树，逐层收紧分支间距；四周布局按子树权重分配方向。展开时固定操作节点与祖先路径，整理其下方子树，其它一级分支保持位置；遇到普通卡片或其它分支时，允许局部加长以避碰。主动「重新排列」会整理整张导图并覆盖手动位置。

新建导图自动采用分支配色：同一一级分支的后代与连线保持同一色系，标题模式额外使用轻量卡片和字号层级；正文模式保留阅读空间。旧导图不会在加载时自动迁移，可通过「重新排列」应用改进布局，通过「选项 → 应用分支样式（保留自定义）」单独更新外观。手动颜色、尺寸与连线颜色会保留；需要重置单节点时使用「恢复层级模板」。原生曲线仍由 Obsidian 绘制。

刷新时，如果无法匹配旧节点（例如标题被删除、改名、跨父级移动或出现重名），插件会显示变更确认，请检查后再应用。

聚焦时固定当前卡片和祖先路径，只临时重排当前可见后代，并缩放到该子树。聚焦非中心节点时，子树沿原分支方向继续生长；径向分支会获得更宽的前向扇区，不再沿用整图中的狭窄扇区。隐藏模式优先紧凑，淡化模式会避让仍可见的背景卡片。聚焦期间的折叠和节点位移只影响当前视图，内容与结构编辑仍正常保存。退出后，已有节点恢复原位置，同时恢复折叠状态、选择和视角；聚焦期间创建的新节点保留新位置。

紧凑聚焦布局默认开启。可在「设置 → Canvas Mind Map → 分支聚焦」中更改默认值，也可用顶部阅读栏的「紧凑布局」仅切换本次聚焦。隐藏或淡化的选择会记住，聚焦状态本身不会保存。「搜索标题」会先退出聚焦再定位结果。

### 语言

在「设置 → Canvas Mind Map → 语言」中选择「自动」「英语」或「简体中文」。自动模式在 `zh-CN` / `zh-Hans` Obsidian 环境中使用简体中文，其他语言均回退英语。新生成内容的占位文本使用当前语言；已有 Canvas 内容不会被翻译或改写。

## 从源码构建

需要 Node.js 和 npm：

```sh
npm install
npm run build
```

生产构建会检查 TypeScript 并生成 `main.js`。将生成的文件与 `manifest.json`、`styles.css` 一起复制到插件目录。开发时可运行 `npm run dev` 持续监听源码变化，按 `Ctrl+C` 结束监听。

`npm test` 运行 Native、Organic 和 Composer 模型回归。`npm run test:composer-browser` 使用无头浏览器与模拟 Obsidian 接口，验证 Composer 交互及转入 Organic 的流程。其他本地环境可通过 `CMM_PLAYWRIGHT` 指定 Playwright 模块路径、`CMM_BROWSER` 指定 Chromium / Edge 可执行文件。这些测试不能替代真实 Vault 验收。

## 反馈

遇到问题或有功能建议，欢迎提交 [Issue](https://github.com/Zenolzx/Canvas-Mind-Map/issues)。请附上 Obsidian 和插件版本、渲染模式、View/Edit 模式、布局、复现步骤，以及可公开的最小笔记示例。

## 致谢与许可证

本项目基于 [Enhanced Canvas](https://github.com/RobertttBS/obsidian-enhanced-canvas) 的部分实现开发，沿用了相关 Canvas 接入代码和辅助实现，感谢原作者及贡献者。在此基础上，本项目聚焦可折叠思维导图，提供多方向布局、统一生成入口和导图管理功能。

采用 [MIT License](LICENSE)，保留上游版权声明，并注明本项目贡献者。
