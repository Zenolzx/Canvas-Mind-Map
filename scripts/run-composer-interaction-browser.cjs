const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.CMM_PLAYWRIGHT||'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CMM_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
  const url=pathToFileURL(path.resolve('tmp/composer-browser/index.html')).href;
  await page.goto(url);await page.waitForFunction(()=>window.ready);
  const state=()=>page.evaluate(()=>window.composerTest.view.history.draft);
  const node=title=>page.locator('svg [role=link]').filter({has:page.locator('text').filter({hasText:new RegExp('^'+title+'$')})});
  const card=title=>page.locator('.cmm-composer-idea-title').filter({hasText:new RegExp('^'+title+'$')});
  const editor=page.locator('.cmm-composer-title-input'),capture=page.getByRole('textbox',{name:'Capture an idea…',exact:true});
  const map=page.locator('.cmm-composer-stage');
  const fit=async()=>{await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('menuitem',{name:'Fit to view',exact:true}).click();};
  const undo=async()=>{await map.focus();await page.keyboard.press('Control+z');};
  const point=async(locator,ratio=.5)=>{const r=await locator.boundingBox();assert.ok(r);return {x:r.x+r.width/2,y:r.y+r.height*ratio};};
  const start=async(locator)=>{const p=await point(locator);await page.mouse.move(p.x,p.y);await page.mouse.down();};
  const move=async(p)=>page.mouse.move(p.x,p.y,{steps:8});
  const drag=async(source,target,ratio=.5)=>{await start(source);await move(await point(target,ratio));await page.mouse.up();};
  await page.evaluate(()=>window.composerTest.seedTemplate('project'));
  await node('Goals').dblclick();assert.equal(await editor.evaluate(el=>el.parentElement.localName),'foreignObject');
  const geometry=await editor.evaluate(el=>({width:el.getBoundingClientRect().width,box:el.closest('[data-node-id]').querySelector('.cmm-organic-hitbox').getBoundingClientRect().width}));assert.ok(Math.abs(geometry.width-geometry.box)<2);
  await editor.fill('Uncommitted title');await page.waitForTimeout(550);assert.equal((await state()).root.children[1].title,'Goals');
  assert.equal(await page.evaluate(()=>window.composerTest.getDisk()[window.composerTest.view.draft.draftId].root.children[1].title),'Goals');
  await page.keyboard.press('Escape');assert.equal((await state()).root.children[1].title,'Goals');
  await node('Goals').hover();await node('Goals').locator('..').getByRole('button',{name:'Add child',exact:true}).click();
  await editor.fill('Direct child');await page.keyboard.press('Enter');assert.equal(await editor.count(),0);assert.equal((await state()).root.children[1].children.length,1);
  await undo();assert.equal((await state()).root.children[1].children.length,0);await page.keyboard.press('Control+Shift+z');assert.equal((await state()).root.children[1].children[0].title,'Direct child');
  await node('Direct child').click();assert.equal(await page.locator('.cmm-composer-body').isVisible(),false);
  await page.locator('.cmm-composer-body-preview').click();await page.locator('.cmm-composer-body textarea').fill('A body preview\n\nwith **details**');
  await page.getByRole('button',{name:'Close Body',exact:true}).click();assert.match(await page.locator('.cmm-composer-body-preview').textContent(),/A body preview with details/);
  await node('Project Plan').click();await fit();
  const before=await point(node('Project Plan')), oldWidth=(await map.boundingBox()).width, selection=(await state()).selection, zoom=await page.evaluate(()=>window.composerTest.view.viewport.scale);
  await page.getByRole('button',{name:'Ideas',exact:true}).click();
  const after=await point(node('Project Plan')),opened=(await map.boundingBox()),sidebar=await page.locator('.cmm-composer-unsorted').boundingBox();
  assert.ok(opened.width<oldWidth-150);assert.ok(sidebar.x+sidebar.width<=opened.x+1);assert.ok(Math.abs(before.x-after.x)<2);assert.equal((await state()).selection,selection);assert.equal(await page.evaluate(()=>window.composerTest.view.viewport.scale),zoom);
  await page.getByRole('button',{name:'Close Ideas',exact:true}).click();assert.ok(Math.abs((await point(node('Project Plan'))).x-before.x)<2);
  await page.getByRole('button',{name:'Ideas',exact:true}).click();
  for(const title of ['Seed A','Seed B','Seed C']) {await capture.fill(title);await capture.press('Enter');assert.equal(await capture.evaluate(el=>document.activeElement===el),true);}
  await capture.fill('输入法');await capture.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));assert.equal((await state()).unsorted.length,3);await capture.fill('');
  await capture.fill('Long thought\nSupporting body\nSecond paragraph');assert.equal(await page.getByRole('button',{name:'As one idea',exact:true}).isVisible(),true);await page.getByRole('button',{name:'As one idea',exact:true}).click();assert.equal((await state()).unsorted[3].body,'Supporting body\nSecond paragraph');
  await capture.fill('Batch 1\n\nBatch 2');await page.getByRole('button',{name:'Split into lines',exact:true}).click();assert.equal((await state()).unsorted.length,6);await undo();assert.equal((await state()).unsorted.length,4);
  await card('Seed A').dblclick();const inline=page.locator('.cmm-composer-idea-input');assert.equal(await inline.evaluate(el=>el.parentElement.classList.contains('cmm-composer-unsorted-node')),true);await inline.fill('Seed renamed');await page.keyboard.press('Enter');assert.equal((await state()).unsorted[0].title,'Seed renamed');
  await card('Seed renamed').click();await card('Seed B').click({modifiers:['Control']});assert.equal((await state()).selections.length,2);
  const bottom=page.locator('.cmm-composer-unsorted-node').filter({has:card('Long thought')});
  await start(card('Seed renamed'));await move(await point(bottom,.95));assert.match(await page.locator('.cmm-composer-drag-ghost').textContent(),/^2/);assert.equal(await page.locator('.cmm-composer-drop').getAttribute('data-position'),'after');await page.mouse.up();assert.deepEqual((await state()).unsorted.map(n=>n.title),['Seed C','Long thought','Seed renamed','Seed B']);
  await undo();assert.deepEqual((await state()).unsorted.map(n=>n.title),['Seed renamed','Seed B','Seed C','Long thought']);
  await card('Seed renamed').click();await card('Seed B').click({modifiers:['Control']});await fit();await drag(card('Seed renamed'),node('Background'));
  assert.deepEqual((await state()).root.children[0].children.map(n=>[n.title,n.type]),[['Seed renamed','heading'],['Seed B','heading']]);await undo();assert.equal((await state()).unsorted[0].type,'idea');
  await card('Seed C').click();await fit();await start(card('Seed C'));const targetRect=await node('Background').boundingBox();await move(await point(node('Background')));
  const captured=await page.locator('.cmm-composer-drop').getAttribute('data-target');await page.mouse.move(targetRect.x-8,targetRect.y+targetRect.height/2);assert.equal(await page.locator('.cmm-composer-drop').getAttribute('data-target'),captured);await page.mouse.up();assert.equal((await state()).root.children[0].children[0].title,'Seed C');
  await undo();
  // Real before / after moves, with one history step and complete subtree retention.
  await node('Goals').click();await fit();await drag(node('Goals'),node('Scope'),.95);assert.deepEqual((await state()).root.children.slice(1,3).map(n=>n.title),['Scope','Goals']);assert.equal((await state()).root.children[2].children[0].body,'A body preview\n\nwith **details**');await undo();
  await fit();await drag(node('Goals'),node('Background'),.05);assert.equal((await state()).root.children[0].title,'Goals');await undo();
  const stable=JSON.stringify((await state()).root);await fit();await start(node('Goals'));await move(await point(node('Scope')));await page.keyboard.press('Escape');await page.mouse.up();assert.equal(JSON.stringify((await state()).root),stable);assert.equal(await page.locator('.cmm-composer-drag-ghost').count(),0);
  await start(node('Goals'));await move(await point(node('Scope')));await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.equal(JSON.stringify((await state()).root),stable);
  // A parked branch retains its subtree. The Inbox only reorders roots by drag.
  await node('Goals').click();const inboxRect=await page.locator('.cmm-composer-unsorted-list').boundingBox();await start(node('Goals'));await move({x:inboxRect.x+inboxRect.width/2,y:inboxRect.y+inboxRect.height-70});await page.mouse.up();
  const parked=(await state()).unsorted.find(n=>n.title==='Goals');assert.equal(parked.children[0].body,'A body preview\n\nwith **details**');assert.equal(await card('Direct child').count(),0);
  const goalsCard=page.locator('.cmm-composer-unsorted-node').filter({has:card('Goals')});await goalsCard.getByRole('button',{name:'Expand / Collapse'}).click();assert.equal(await card('Direct child').count(),1);
  await card('Seed B').click();await drag(card('Seed B'),card('Direct child'));assert.equal((await state()).unsorted.find(n=>n.title==='Goals').children.length,1);assert.ok((await state()).unsorted.some(n=>n.title==='Seed B'));await undo();
  await page.getByRole('searchbox',{name:'Search ideas',exact:true}).fill('details');assert.equal(await card('Goals').count(),1);assert.equal(await card('Seed B').count(),0);await page.getByRole('searchbox',{name:'Search ideas',exact:true}).fill('');
  await fit();await drag(card('Goals'),node('Scope'));assert.equal((await state()).root.children.find(n=>n.title==='Scope').children[0].children[0].body,'A body preview\n\nwith **details**');
  // Hidden inbox auto-opens after a deliberate hover during a drag.
  await page.getByRole('button',{name:'Close Ideas',exact:true}).click();await fit();await start(node('Milestones'));await move(await point(page.locator('.cmm-composer-ideas-entry')));await page.waitForTimeout(450);assert.equal(await page.locator('.cmm-composer-unsorted').isVisible(),true);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.locator('.cmm-composer-context button').count(),1);await node('Scope').click({button:'right'});const menuText=await page.getByRole('menu').textContent();assert.ok(!/Add child|Add sibling|Move before|Move after|Move to Unsorted/.test(menuText));await page.getByRole('menuitem',{name:'Duplicate',exact:true}).click();assert.equal((await state()).root.children.filter(n=>n.title==='Scope').length,2);await undo();
  for(const layout of ['Radial','Compact','Horizontal']) {await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('menuitem',{name:'Layout',exact:true}).click();await page.getByRole('menuitem',{name:layout,exact:true}).click();assert.ok((await map.boundingBox()).width>240);}
  await page.screenshot({path:'tmp/composer-browser/composer-inbox-en.png'});
  await page.setViewportSize({width:560,height:800});await page.locator('.cmm-composer-body-preview').click();const narrow=await map.boundingBox(),side=await page.locator('.cmm-composer-unsorted').boundingBox(),body=await page.locator('.cmm-composer-body').boundingBox();assert.ok(side.x+side.width<=narrow.x+1);assert.ok(narrow.x+narrow.width<=body.x+1);assert.ok(narrow.width>=240);
  await page.goto(url+'?lang=zh-CN');await page.waitForFunction(()=>window.ready);await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'灵感箱',exact:true}).click();await page.getByRole('textbox',{name:'记录一个想法…',exact:true}).fill('双语灵感');await page.getByRole('textbox',{name:'记录一个想法…',exact:true}).press('Enter');assert.equal((await state()).unsorted[0].title,'双语灵感');
  await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('menuitem',{name:'从模板新建',exact:true}).click();assert.equal(await page.getByRole('button',{name:'项目计划',exact:true}).count(),1);await page.evaluate(()=>document.querySelector('.test-modal').remove());
  await page.getByRole('button',{name:'创建笔记',exact:true}).click();await page.getByRole('button',{name:'预览 Markdown',exact:true}).click();assert.match(await page.getByRole('alert').textContent(),/灵感箱/);await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.screenshot({path:'tmp/composer-browser/composer-inbox-zh.png'});
  const languageDraft=await state();await page.getByRole('textbox',{name:'记录一个想法…',exact:true}).fill('Still typing');await page.evaluate(()=>window.composerTest.setLanguage('en'));assert.equal(await capture.inputValue(),'Still typing');assert.equal((await state()).root.title,languageDraft.root.title);assert.deepEqual((await state()).unsorted,languageDraft.unsorted);assert.equal(await page.getByRole('button',{name:'Create Note',exact:true}).count(),1);
  await page.evaluate(()=>window.composerTest.setLanguage('zh-CN'));await page.evaluate(()=>window.composerTest.setLanguage('en'));await capture.press('Enter');assert.equal((await state()).unsorted.length,2);assert.equal((await state()).unsorted[1].title,'Still typing');
  assert.deepEqual(errors,[]);
  console.log('PASS Composer direct browser: in-node editing, draft isolation, hover creation, body preview, stable dock, Inbox capture/batch/search/sort, multi-drag, before/child/after, tolerance, cancellation, subtree transfers, hover-open, menu disclosure, narrow layout and bilingual dialogs');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
