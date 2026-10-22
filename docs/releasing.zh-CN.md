# 发布 Canvas Mind Map 1.2.0

本次版本号为 **1.2.0**。`manifest.json`、`package.json`、`package-lock.json` 根版本及 `versions.json` 已同步。历史 `release-1.1.0.md`、`release-1.1.1.md` 保留原版本号，它们是历史记录，不应全局替换。

仓库目前只有验证工作流 `.github/workflows/verify.yml`，没有自动创建 Release 或上传附件的工作流。只推送标签不会自动发布安装包。以下两种发布方式任选一种。

## 1. 发布前准备

在项目根目录执行：

```powershell
npm ci
npm run lint
npm test
npm run release:prepare
```

`release:prepare` 会先执行生产构建，检查版本一致性，再生成 `dist/1.2.0/`，包含 `main.js`、`manifest.json`、`styles.css` 与可选校验文件 `SHA256SUMS.txt`。该目录被 Git 忽略，不需要把打包产物强制加入源码提交。

用该目录的三个插件文件在测试仓库安装，确认设置中的版本为 1.2.0，打开已有笔记、已有 Canvas 和已保存草稿。若使用 Enhanced Canvas，按[兼容性说明](enhanced-canvas-compatibility.md)检查对应版本。本次没有移动端实测记录；不要将清单的移动端可加载声明描述成已经完成移动端验收。

先查看 `git status --short` 与 `git diff`，确认本次功能代码、新增兼容模块、测试、文档和图片都在待发布提交中。不要只提交 README 和版本号而漏掉尚未提交的兼容性代码。`docs/product-readiness-audit.md` 等本地审计文件应单独判断是否公开，不要无差别执行 `git add .`。

选择并提交本次发布文件，推送到 `main`，等待 GitHub 的 `verify` 工作流通过。若推送前又改了源码，重新执行测试和 `npm run release:prepare`，确保附件对应最终提交。

## 2A. 使用 GitHub 网页发布

1. 打开 [创建 Release](https://github.com/Zenolzx/Canvas-Mind-Map/releases/new)。
2. 标签填 **`1.2.0`**，不要加 `v`。目标选择已通过验证的 `main` 提交；若标签已存在，确认它指向本次发布提交。
3. 标题：**`Canvas Mind Map 1.2.0 — A clearer space for your ideas`**。
4. 正文直接复制 [release-1.2.0.md](release-1.2.0.md) 的内容，已同时包含英语和简体中文。无需再叠加自动生成的提交列表。
5. 从 `dist/1.2.0/` 分别上传 **`main.js`、`manifest.json`、`styles.css`**。可另上传 `SHA256SUMS.txt`。不要只传 ZIP 或 Source code；三个文件必须是 Release 独立附件，名字保持不变。
6. 先保存为 Draft，检查附件齐全、正文链接与预览正确。正式发布时不勾选 Pre-release，并按需要设为 Latest。
7. 点击 **Publish release** 后，再做下方核对。

## 2B. 使用 GitHub CLI 创建草稿

要求已安装并登录 `gh`，且发布提交已推送、CI 已通过。先将下面的 `<release-commit>` 替换为最终提交 SHA，然后执行：

```powershell
git tag -a 1.2.0 <release-commit> -m "Canvas Mind Map 1.2.0"
git push origin 1.2.0
gh release create 1.2.0 dist/1.2.0/main.js dist/1.2.0/manifest.json dist/1.2.0/styles.css dist/1.2.0/SHA256SUMS.txt --verify-tag --draft --title "Canvas Mind Map 1.2.0 — A clearer space for your ideas" --notes-file docs/release-1.2.0.md
```

若已有正确标签，跳过前两条。命令只创建草稿；在网页核对后发布，或自行执行：

```powershell
gh release edit 1.2.0 --draft=false --latest
```

不要覆盖已公开的错误标签或悄悄替换已发布附件；如发布后发现问题，修复后递增补丁号重新发布。

## 3. 发布后核对

- [Release 1.2.0](https://github.com/Zenolzx/Canvas-Mind-Map/releases/tag/1.2.0) 能打开，且不是草稿或预发布。
- 可分别下载三个安装文件；下载的 `manifest.json` 版本为 `1.2.0`，与标签完全一致。
- 在测试 Vault 的社区插件页面检查更新并安装，再确认版本、文档打开和草稿恢复。列表刷新可能需要等待。
- 已收录的插件更新通常无需重新提交社区插件申请；Obsidian 根据仓库清单和匹配标签获取附件。不要仅以“GitHub 页面显示 Latest”判断安装链路正常。

## 官方依据

- [Obsidian：提交与 Release 附件要求](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)：标签必须匹配清单版本，上传可安装附件。
- [Obsidian：版本兼容映射](https://docs.obsidian.md/Reference/Versions)：`versions.json` 用于旧版宿主的兼容回退；本项目列出 1.1.1 与 1.2.0 的声明最低版本，不伪造未核对的历史数据。

当前材料只完成本地准备，没有替你推送代码、创建标签或发布 Release。
