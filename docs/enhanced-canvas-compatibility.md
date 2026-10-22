# Enhanced Canvas 兼容性

Canvas Mind Map 无需 Enhanced Canvas 即可运行。以下结果来自隔离 Obsidian 仓库中的真实插件共存测试，不代表所有历史版本或其他插件组合均已验证。

| 对象 | 已验证范围 |
| --- | --- |
| 官方 Enhanced Canvas 1.0.33，源码提交 `7e689a0e169ebf7bce91ca31844da287544d1c15` | 两种加载顺序、标题拆分、脑图生成与折叠、普通文件卡片属性同步、外部连线与自定义字段保留、保存重开、分别禁用 |
| 本机 Enhanced Canvas 1.0.29 改版，含早期脑图引擎 | 两种加载顺序、旧脑图生成、显式迁移、原生撤销、折叠状态、保存重开、禁用旧插件后继续使用 |

## 旧导图迁移

在旧导图节点菜单选择“迁移此导图到 Canvas Mind Map”。迁移只转交当前导图的元数据归属，保留节点 ID、内容、位置、来源信息、样式、折叠状态及其他连线。迁移后由 Canvas Mind Map 管理，旧引擎不再为这些节点提供生成菜单或重新生成。立即使用 Canvas 撤销可恢复旧格式。

不会自动迁移。结构损坏、父节点缺失或已经混合两种归属的数据会拒绝迁移，避免部分改写。官方 1.0.33 与上述本机改版不同，官方源码没有这一早期脑图引擎。

## 属性同步边界

Enhanced Canvas 根据文件卡片及其连线维护 Markdown 属性。Canvas Mind Map 的标题脑图是文本卡片，即便内容含笔记链接，也不属于文件卡片；这些脑图连线不会自动进入 Enhanced Canvas 的笔记属性。普通文件卡片的属性同步已验证，不能据此推断所有脑图节点都支持该同步。

## 验证入口

- `node scripts/verify-enhanced-migration.cjs`：无损迁移、异常结构原子拒绝。
- `node scripts/verify-enhanced-interop.cjs`：引擎归属与卸载恢复。
- `node scripts/verify-enhanced-canvas-live.cjs`：专用测试仓库、CDP 9238，安装官方源码构建后运行。
- `node scripts/verify-enhanced-legacy-live.cjs`：同一专用仓库，使用环境变量 `CMM_LEGACY_ENHANCED_SOURCE` 指定本机改版源码；只改写测试仓库中的插件副本。

实时测试脚本检查仓库路径为 `tmp/enhanced-coexist-live`，不操作日常仓库。结果写入 `tmp/enhanced-coexist-live-results`。
