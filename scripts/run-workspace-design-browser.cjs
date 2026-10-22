const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchOptions, requireTooling } = require('./lib/browser.cjs');
const { chromium } = requireTooling('Workspace design');
(async () => {
 const browser = await chromium.launch(launchOptions());
 const dir = 'tmp/workspace-design'; fs.mkdirSync(dir, { recursive: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('tmp/composer-browser/index.html')).href + '?lang=zh-CN');
  await page.waitForFunction(() => window.ready);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${dir}/empty.png` });
  await page.getByRole('button', { name: '工作区外观', exact: true }).click();
  await page.getByRole('button', { name: '深夜石墨', exact: true }).click();
  assert.equal(await page.locator('.cmm-composer').getAttribute('data-cmm-appearance'), 'slate');
  await page.screenshot({ path: `${dir}/appearance.png` });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.cmm-composer').getAttribute('data-cmm-appearance'), 'ink');
  await page.evaluate(() => {
   const v = window.composerTest.view;
   const make = (title, children = []) => ({ id: crypto.randomUUID(), title, type: 'heading', body: '', children });
   v.draft.root.title = '把想法变成作品';
   v.draft.root.children = [
    make('发现与研究', [make('收集真实的用户反馈'), make('梳理问题与使用场景'), make('建立参考资料库')]),
    make('设计与表达', [make('确定产品视觉方向'), make('统一界面与交互'), make('打磨关键使用流程')]),
    make('构建与验证', [make('完成核心能力'), make('验证真实工作场景'), make('持续迭代与发布')]),
    make('灵感与探索', [make('留下尚未成形的想法'), make('连接不同领域的知识')]),
   ];
   v.draft.unsorted = [make('更自然的灵感收集方式'), make('让阅读与写作保持连贯')];
   v.draft.selection = v.draft.root.children[1].id;
   v.draft.root.children[1].body = '让内容自然成为视觉中心。\n\n从一张脑图开始，在灵感、结构与正文之间流畅切换。\n\n- 统一的工作区骨架\n- 有温度的画布材质\n- 清晰的节点与分支层级';
   v.interacted = true; v.render(); v.fit();
  });
  for (const theme of ['ink', 'slate', 'breeze']) {
   await page.evaluate(theme => { window.composerTest.applyPreset(theme, 'paper'); window.composerTest.view.fit(); }, theme);
   await page.waitForTimeout(200);
   await page.screenshot({ path: `${dir}/${theme}.png` });
  }
  await page.evaluate(() => { const v = window.composerTest.view; window.composerTest.applyPreset('ink','paper'); v.drawerOpen = true; v.renderDrawer(); v.openBody(); v.fit(); });
  await page.screenshot({ path: `${dir}/writing.png` });
  for (const width of [1440, 1024, 720, 480]) {
   await page.setViewportSize({ width, height: 900 });
   await page.evaluate(() => { const v = window.composerTest.view; v.drawerOpen = true; v.renderDrawer(); v.openBody(); v.fit(); });
   await page.waitForTimeout(80);
   const geometry = await page.evaluate(() => {
    const root = document.querySelector('.cmm-composer'), stage = document.querySelector('.cmm-composer-stage');
    const body = document.querySelector('.cmm-composer-body'), modes = document.querySelector('.cmm-workspace-modes');
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
    return { root:rect(root),stage:rect(stage),body:rect(body),modes:rect(modes),overflow:root.scrollWidth > root.clientWidth + 1, inbox:!document.querySelector('.cmm-composer-unsorted').hidden };
   });
   assert.equal(geometry.overflow, false, `${width}: shell overflows`);
   assert.ok(geometry.stage.width >= 200, `${width}: stage is squeezed`);
   assert.ok(geometry.body.right <= width + 1, `${width}: body escapes pane`);
   assert.ok(geometry.modes.x >= 0 && geometry.modes.right <= width, `${width}: modes escape pane`);
   if (width < 900) assert.equal(geometry.inbox, false, 'narrow panels must be mutually exclusive');
   await page.screenshot({ path: `${dir}/width-${width}.png` });
  }
  await page.setViewportSize({ width:1440,height:900 });
  // A narrow Obsidian split must respond to pane width, even inside a wide app window.
  await page.evaluate(() => { document.querySelector('.cmm-composer').style.width = '480px'; const v=window.composerTest.view; v.applyPanel(); });
  assert.ok(await page.locator('.cmm-composer-body').evaluate(el => el.getBoundingClientRect().right <= 481));
  await page.screenshot({ path: `${dir}/narrow-pane.png` });
  assert.deepEqual(errors, []);
  console.log('PASS workspace design: theme preview/cancel, 3 themes, Chinese content, 4 widths, narrow host split, panel exclusivity, no runtime errors');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
