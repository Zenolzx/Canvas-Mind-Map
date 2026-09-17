const path=require('node:path');
const {chromium}=require(process.env.CMM_PLAYWRIGHT||'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
 try {
  const pages=browser.contexts().flatMap(context=>context.pages());
  console.log('Test surfaces:',pages.map(page=>page.url()));
  const page=pages.find(page=>page.url().includes('index.html'));
  if(!page)throw new Error('Test vault has not opened');
  await page.waitForFunction(()=>window.app?.workspace?.layoutReady,{},{timeout:20000});
  const expected=path.resolve('tmp/obsidian-writing-live');
  const actual=await page.evaluate(()=>app.vault.adapter.getBasePath());
  if(actual!==expected)throw new Error('Refusing to operate outside isolated test vault: '+actual);
  if(process.argv.includes('--close')) {
   const session=await browser.newBrowserCDPSession();await session.send('Browser.close');console.log('Closed isolated Obsidian test instance');return;
  }
  console.log(await page.evaluate(()=>({vault:app.vault.getName(),plugins:Object.keys(app.plugins.plugins)})));
  if(process.argv.includes('--inspect')) {
   console.log(await page.evaluate(async()=>({text:document.body.innerText.slice(-1500),source:await app.vault.read(app.vault.getAbstractFileByPath('Article.md')),
    views:app.workspace.getLeavesOfType('markdown').map(leaf=>({mode:leaf.view.getMode(),data:leaf.view.getViewData(),file:leaf.view.file?.path})),
    host:(()=>{const host=app.workspace.getLeavesOfType('canvas-mind-map-organic').map(l=>l.view.documentHost).find(Boolean);return host?{peers:host.peers('Article.md').map(cm=>cm.state.doc.toString()),views:app.workspace.getLeavesOfType('markdown').map(l=>({mode:l.view.getMode(),registered:host.hasEditor(l.view)}))}:null;})(),
    pluginKeys:Object.keys(app.plugins),enabled:[...app.plugins.enabledPlugins],manifests:Object.keys(app.plugins.manifests)})));
   return;
  }
  const trust=page.getByRole('button',{name:'信任仓库作者并启用插件',exact:true});
  if(await trust.count())await trust.click();
  await page.waitForFunction(()=>!!app.plugins.plugins['canvas-mind-map'],{},{timeout:15000});
  if(process.argv.includes('--reload')) {
   await page.evaluate(async()=>{await app.plugins.disablePlugin('canvas-mind-map');await app.plugins.enablePlugin('canvas-mind-map');});
   await page.waitForFunction(()=>!!app.plugins.plugins['canvas-mind-map']);
  }
  const result=await page.evaluate(async()=>{
   const file=app.vault.getAbstractFileByPath('Article.md');
   const original=await app.vault.read(file);
   const nativeLeaf=app.workspace.getLeaf('tab');await nativeLeaf.openFile(file);
   const previewLeaf=app.workspace.getLeaf('split');await previewLeaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});
   const leaf=app.workspace.getLeaf('split');await leaf.setViewState({type:'canvas-mind-map-organic',state:{file:file.path},active:true});
   const view=leaf.view;if(!view.isWriting)await view.toggleWriting();
   if(!view.isWriting)throw new Error('Writing mode failed to open');
   const writing=view.writing;
   const find=title=>Array.from(writing.document.sections.values()).find(section=>section.headingText===title)?.id;
   const success=await writing.execute({type:'rename',nodeId:find('Method'),title:'Method and Design'});
   if(!success)throw new Error('Native host rejected rename');
   await new Promise(resolve=>setTimeout(resolve,2500));
   const renamed=await app.vault.read(file);
   if(!renamed.includes('# Method and Design')||!renamed.includes('Original body **formatting**.'))throw new Error('Rename source mismatch');
   if(nativeLeaf.view.editor.getValue()!==renamed)throw new Error('Native editor synchronization mismatch');
   if(previewLeaf.view.getViewData()!==renamed)throw new Error('Native reading preview synchronization mismatch');
   await writing.select(find('Training'));
   const cm=writing.editor.view;
   cm.dispatch({changes:{from:cm.state.doc.length,insert:'\nReal host body addition.\n'}});
   if(!await writing.editor.flush())throw new Error('Body save failed');
   await new Promise(resolve=>setTimeout(resolve,2500));
   if(!(await app.vault.read(file)).includes('Real host body addition.'))throw new Error('Body overwritten by native autosave');
   await writing.history('undo');
   if((await app.vault.read(file)).includes('Real host body addition.'))throw new Error('Undo did not restore body');
   await writing.history('undo');
   if(await app.vault.read(file)!==original)throw new Error('Undo did not restore original source bytes');
   const stale=writing.coordinator.prepare({type:'rename',nodeId:find('Method'),title:'Must not overwrite'});
   const editor=nativeLeaf.view.editor;
   const externalTitle='External Dataset '+Date.now();
   editor.replaceRange('\n# '+externalTitle+'\n',editor.offsetToPos(editor.getValue().length));
   await nativeLeaf.view.save();
   let conflict=false;try{await writing.coordinator.commit(stale);}catch{conflict=true;}
   const externallyEdited=await app.vault.read(file);
   if(!conflict||!externallyEdited.includes('# '+externalTitle)||externallyEdited.includes('Must not overwrite'))throw new Error('Native external edit was overwritten');
   await new Promise(resolve=>setTimeout(resolve,2500));
   await writing.refresh();if(!find(externalTitle))throw new Error('External heading refresh failed');
   editor.setValue(original);await nativeLeaf.view.save();await writing.externalChange();
   if(await app.vault.read(file)!==original)throw new Error('Test fixture restoration failed');
   await view.toggleWriting();await view.toggleWriting();
   if(view.writing!==writing)throw new Error('Mode switch lost shared session');
   window.cmmLiveTest={view,nativeLeaf,file};
   return {sourceRestored:true,nativeEditorSynchronized:true,externalConflictProtected:true,sharedSession:true};
  });
  console.log('PASS real Obsidian host:',JSON.stringify(result));
  await page.screenshot({path:'tmp/obsidian-writing-live.png'});
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
