const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireTooling } = require('./lib/browser.cjs');
const { chromium } = requireTooling('Obsidian workspace design');
(async () => {
 const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
 try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html'));
  assert.ok(page, 'isolated Obsidian page is available');
  const expected = path.resolve('tmp/obsidian-writing-live');
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),expected,'only the isolated test vault may be updated');
  for(const file of ['main.js','styles.css','manifest.json']) fs.copyFileSync(file,path.join(expected,'.obsidian/plugins/canvas-mind-map',file));
  await page.evaluate(async()=>{await app.plugins.disablePlugin('canvas-mind-map');await app.plugins.enablePlugin('canvas-mind-map');});
  const report = await page.evaluate(async expected => {
   if (app.vault.adapter.getBasePath() !== expected) throw new Error('Refusing to modify a non-test vault');
   const plugin = app.plugins.plugins['canvas-mind-map'];
   if (!plugin) throw new Error('Plugin is not loaded');
   plugin.settings.appearance = 'ink'; plugin.settings.surfaceMaterial = 'paper'; plugin.settings.backgroundImage = '';
   app.workspace.leftSplit?.collapse(); app.workspace.rightSplit?.collapse();
   const leaf = app.workspace.getLeaf('tab'); await leaf.setViewState({ type:'canvas-mind-map-composer',active:true,state:{} });
   const v = leaf.view;
   const make = (title,children=[]) => ({id:crypto.randomUUID(),title,children,type:'heading',body:'',collapsed:false,metadata:{}});
   v.change(draft => {
    draft.root.title='把想法变成作品';
    draft.root.children=[make('发现与研究',[make('收集真实用户反馈'),make('梳理问题与场景')]),make('设计与表达',[make('确定视觉方向'),make('打磨交互流程')]),make('构建与验证',[make('完成核心能力'),make('验证真实工作场景')])];
    draft.root.children[1].body='让内容自然成为视觉中心。\n\n在灵感、结构与正文之间流畅切换。';
    draft.unsorted=[make('更自然的灵感收集方式')];draft.selection=draft.root.children[1].id;
   });
   plugin.refreshAppearance(); v.fit();
   window.workspaceDesignLive={leaf,v,plugin};
   const root=v.contentEl;
   const style=getComputedStyle(root);
   return {version:plugin.manifest.version,appearance:root.dataset.cmmAppearance,material:root.dataset.cmmMaterial,
    background:style.backgroundImage,header:root.querySelector('.cmm-composer-toolbar').getBoundingClientRect().height,
    modes:root.querySelectorAll('.cmm-workspace-modes button').length,width:root.clientWidth,height:root.clientHeight};
  },expected);
  assert.equal(report.modes,3); assert.equal(report.appearance,'ink'); assert.equal(report.material,'paper');
  assert.ok(report.background.includes('radial-gradient'),'host must show the material atmosphere');
  assert.ok(report.height > 300); assert.ok(report.header >= 48 && report.header <= 100);
  fs.mkdirSync('tmp/workspace-design',{recursive:true});
  await page.waitForTimeout(10500);
  await page.screenshot({path:'tmp/workspace-design/obsidian-light.png'});
  await page.evaluate(()=>{const {v,plugin}=window.workspaceDesignLive;plugin.settings.appearance='slate';plugin.refreshAppearance();v.openBody();});
  await page.waitForTimeout(250);
  const dark = await page.evaluate(()=>{const {v}=window.workspaceDesignLive;const box=v.scene.querySelector('.cmm-organic-hitbox');return {paper:getComputedStyle(v.contentEl).backgroundColor,fill:getComputedStyle(box).fill,ink:getComputedStyle(v.scene.querySelector('text')).fill};});
  const editor = await page.evaluate(()=>{const s=getComputedStyle(window.workspaceDesignLive.v.body);return {resize:s.resize,shadow:s.boxShadow};});
  assert.deepEqual(editor,{resize:'none',shadow:'none'},'host textarea styles must not override the writing surface');
  console.log('Host palette:', JSON.stringify(await page.evaluate(()=>{
   const {v}=window.workspaceDesignLive,s=getComputedStyle(v.contentEl),name=getComputedStyle(v.documentButton);
   const rules=[]; for(const sheet of document.styleSheets) { try { for(const r of sheet.cssRules) if(r.selectorText && v.contentEl.matches(r.selectorText) && (r.style?.background || r.style?.backgroundColor))rules.push({selector:r.selectorText,background:r.style.background,color:r.style.backgroundColor}); }catch{} }
   return {appearance:v.contentEl.dataset.cmmAppearance,paper:s.getPropertyValue('--cmm-paper'),background:s.backgroundColor,display:s.display,rules,name:{textAlign:name.textAlign,justifyContent:name.justifyContent,width:name.width,padding:name.padding,gridColumn:name.gridColumn}};
  })));
  assert.equal(dark.paper,'rgb(27, 35, 40)'); assert.notEqual(dark.fill,'rgb(255, 255, 255)'); assert.notEqual(dark.ink,dark.fill);
  await page.screenshot({path:'tmp/workspace-design/obsidian-dark-writing.png'});
  // Real plugin picker must restore after cancellation and persist after Apply.
  await page.evaluate(()=>window.workspaceDesignLive.v.openAppearancePicker());
  await page.locator('.cmm-theme-option[data-theme="breeze"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.cmm-composer').last().getAttribute('data-cmm-appearance'),'slate');
  await page.evaluate(()=>window.workspaceDesignLive.v.openAppearancePicker());
  await page.locator('.cmm-theme-option[data-theme="ink"]').click();
  await page.locator('.cmm-appearance-actions .mod-cta').click();
  await page.waitForFunction(()=>!document.querySelector('.cmm-appearance-picker'));
  const saved = await page.evaluate(async()=>{
   const {v,plugin}=window.workspaceDesignLive;
   await plugin.composerDrafts.flush();
   const data=JSON.parse(await app.vault.adapter.read('.obsidian/plugins/canvas-mind-map/data.json'));
   return {appearance:data.appearance,material:data.surfaceMaterial,draftId:v.draft.draftId};
  });
  assert.equal(saved.appearance,'ink'); assert.equal(saved.material,'paper');
  console.log('PASS real Obsidian workspace:', JSON.stringify({ ...report,background:report.background.slice(0,90),dark,saved }));
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
