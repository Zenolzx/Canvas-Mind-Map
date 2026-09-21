const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.CMM_PLAYWRIGHT||'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CMM_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('tmp/composer-browser/index.html')).href);await page.waitForFunction(()=>window.ready);
  const state=()=>page.evaluate(()=>window.composerTest.view.history.draft);
  assert.equal(await page.evaluate(()=>window.composerTest.getCreated()),0);
  assert.equal(await page.locator('.cmm-composer-body').isVisible(),false);
  assert.equal(await page.locator('.cmm-composer-unsorted').isVisible(),false);
  assert.equal(await page.locator('.cmm-composer-search').isVisible(),false);
  assert.equal(await page.locator('.cmm-composer-toolbar > button').count(),5);
  await page.keyboard.press('Control+Enter');assert.equal(await page.locator('.cmm-composer-body').isVisible(),true);
  await page.getByRole('button',{name:'Pin',exact:true}).click();assert.equal((await state()).panel,'show');
  await page.getByRole('button',{name:'Pin',exact:true}).click();assert.equal((await state()).panel,'auto');
  await page.getByRole('button',{name:'Close Body',exact:true}).click();assert.equal(await page.locator('.cmm-composer-body').isVisible(),false);
  for (const title of ['Radial','Compact','Horizontal']) {
   await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('menuitem',{name:'Layout',exact:true}).click();await page.getByRole('menuitem',{name:title,exact:true}).click();
  }
  for (const title of ['Show','Hide','Auto']) {
   await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('menuitem',{name:'Body',exact:true}).click();await page.getByRole('menuitem',{name:title,exact:true}).click();
   assert.equal(await page.locator('.cmm-composer-body').isVisible(),title==='Show');
  }
  // Native dblclick must retain its target through the first click's selection update.
  const root=page.locator('svg [role="link"]').first();
  await root.focus();await page.keyboard.press('Enter');assert.equal((await state()).root.children.length,1);await page.keyboard.press('Escape');assert.equal((await state()).root.children.length,0);
  await root.dblclick();
  assert.equal(await page.locator('.cmm-composer-title-input').evaluate(el=>document.activeElement===el && el.selectionStart===0 && el.selectionEnd===el.value.length),true);
  await page.locator('.cmm-composer-title-input').fill('Cancelled');await page.keyboard.press('Escape');
  assert.equal((await state()).root.title,'Untitled');
  await page.getByRole('button',{name:'View',exact:true}).focus();await page.keyboard.press('F2');await page.locator('.cmm-composer-title-input').fill('Blur saved');
  await page.getByRole('button',{name:'Search',exact:true}).click();assert.equal((await state()).root.title,'Blur saved');
  await page.getByRole('searchbox').press('Escape');
  await page.keyboard.press('F2');await page.locator('.cmm-composer-title-input').fill('Operating Systems');await page.keyboard.press('Enter');assert.equal((await state()).root.children.length,0);
  await page.keyboard.press('Enter');await page.locator('.cmm-composer-title-input').fill('Process');await page.keyboard.press('Enter');await page.locator('.cmm-composer-title-input').fill('Memory');
  await page.locator('.cmm-composer-title-input').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
  assert.equal((await state()).root.children.length,2);
  await page.keyboard.press('Tab');await page.locator('.cmm-composer-title-input').fill('Paging');await page.keyboard.press('Enter');await page.keyboard.press('Escape');
  let d=await state();assert.deepEqual(d.root.children.map(n=>n.title),['Process','Memory']);assert.equal(d.root.children[1].children[0].title,'Paging');
  await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('menuitem',{name:'Fit to view',exact:true}).click();
  const ordinary=page.locator('svg [role="link"]').filter({has:page.locator('text',{hasText:/^Process$/})});
  await ordinary.dblclick();await page.locator('.cmm-composer-title-input').fill('Process renamed');await page.keyboard.press('Enter');
  assert.equal((await state()).root.children.length,2);
  await page.keyboard.press('F2');await page.locator('.cmm-composer-title-input').fill('Cancelled node');await page.keyboard.press('Escape');
  assert.equal((await state()).root.children[0].title,'Process renamed');
  await page.keyboard.press('F2');await page.locator('.cmm-composer-title-input').fill('Process');await page.keyboard.press('Enter');
  await page.evaluate(()=>{const v=window.composerTest.view;v.select(v.draft.root.children[1].children[0].id);});
  await page.keyboard.press('Control+Enter');const body=page.locator('.cmm-composer-body textarea');await body.fill('Paging body.\n\n- Page table');
  await page.keyboard.press('Escape');await page.keyboard.press('Alt+ArrowLeft');assert.equal((await state()).root.children[2].title,'Paging');
  await page.keyboard.press('Control+z');assert.equal((await state()).root.children[1].children[0].body,'Paging body.\n\n- Page table');
  await page.keyboard.press('Control+Shift+z');assert.equal((await state()).root.children[2].title,'Paging');
  await page.keyboard.press('Alt+ArrowRight');
  await page.evaluate(()=>{const v=window.composerTest.view;v.select(v.draft.root.children[1].id);});
  await page.keyboard.press('Delete');await page.getByRole('button',{name:'Delete node but keep children',exact:true}).click();assert.equal((await state()).root.children[1].title,'Paging');
  await page.locator('.cmm-composer-stage').focus();await page.keyboard.press('Control+z');assert.equal((await state()).root.children[1].children[0].title,'Paging');
  await page.evaluate(()=>{const v=window.composerTest.view;v.draft.panel='hide';v.render();v.fit();});
  async function point(title,ratio=.5){return page.evaluate(({title,ratio})=>{const v=window.composerTest.view,n=v.result.nodes.find(n=>n.title===title);const el=Array.from(v.scene.querySelectorAll('[data-node-id]')).find(el=>el.getAttribute('data-node-id')===n.id),r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height*ratio};},{title,ratio});}
  const start=await point('Memory'),end=await point('Process');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:10});
  assert.match(await page.locator('.cmm-composer-drop').textContent(),/Make child ◀/);assert.equal((await state()).root.children.length,2);await page.mouse.up();
  d=await state();assert.equal(d.root.children[0].children[0].children[0].body,'Paging body.\n\n- Page table');
  await page.evaluate(()=>{const v=window.composerTest.view;v.render();v.fit();});
  const cycleStart=await point('Process'),cycleEnd=await point('Paging');await page.mouse.move(cycleStart.x,cycleStart.y);await page.mouse.down();await page.mouse.move(cycleEnd.x,cycleEnd.y,{steps:10});assert.match(await page.locator('.cmm-composer-drop').textContent(),/itself/);await page.mouse.up();
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>Object.values(window.composerTest.getDisk())[0].root.children[0].children[0].children[0].body),'Paging body.\n\n- Page table');
  await page.screenshot({path:'tmp/composer-browser/composer.png'});
  await page.getByRole('button',{name:'Create Note',exact:true}).click();assert.equal(await page.locator('.test-modal input').nth(1).inputValue(),'Projects');
  await page.locator('.test-modal input').first().fill('bad/name');await page.getByRole('button',{name:'Create',exact:true}).click();assert.match(await page.locator('[role="alert"]').textContent(),/valid/);assert.equal(await page.evaluate(()=>window.composerTest.getCreated()),0);
  await page.evaluate(()=>window.composerTest.seedFile('Projects/Existing.md','Original content'));
  await page.locator('.test-modal input').first().fill('Existing');await page.getByRole('button',{name:'Create',exact:true}).click();assert.match(await page.locator('[role="alert"]').textContent(),/already exists/);
  assert.equal(await page.evaluate(()=>window.composerTest.contents.get('Projects/Existing.md')),'Original content');assert.equal(await page.evaluate(()=>window.composerTest.getCreated()),0);
  await page.locator('.test-modal input').first().fill('Operating Systems');
  await page.evaluate(()=>window.composerTest.setFail(true));await page.getByRole('button',{name:'Create',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="alert"]').textContent.includes('disk full'));
  assert.equal(await page.evaluate(()=>window.composerTest.getCreated()),0);assert.equal(await page.evaluate(()=>Object.keys(window.composerTest.store.data).length),1);
  await page.evaluate(()=>window.composerTest.setFail(false));
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.waitForFunction(()=>window.composerTest.getHandoff());
  assert.equal(await page.evaluate(()=>window.composerTest.getCreated()),1);assert.equal(await page.evaluate(()=>window.composerTest.getHandoff().state.writing),true);
  assert.equal(await page.evaluate(()=>Object.keys(window.composerTest.store.data).length),0);
  assert.equal(await page.evaluate(()=>window.composerTest.contents.get('Projects/Operating Systems.md')),'# Process\n\n## Memory\n\n### Paging\n\nPaging body.\n\n- Page table\n');
  assert.deepEqual(errors,[]);console.log('PASS Composer browser: root rename, continuous input, IME, body, promote/demote, undo/redo, real drag/drop and cycle preview, autosave, destination folder, Markdown creation and handoff');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
