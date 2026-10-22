const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./lib/browser.cjs').requireTooling('Enhanced Canvas coexistence');
(async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:9238');try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('index.html'));
 assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),path.resolve('tmp/enhanced-coexist-live'));
 const trust=page.getByRole('button',{name:'信任仓库作者并启用插件',exact:true});
 if(await trust.count()){await trust.click();await page.waitForTimeout(1000);}
 await page.evaluate(async()=>{for(const id of ['canvas-mind-map','enhanced-canvas'])if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);});
 const source=process.env.CMM_OFFICIAL_ENHANCED_SOURCE||path.resolve('tmp/enhanced-canvas-compat');
 const target=path.resolve('tmp/enhanced-coexist-live/.obsidian/plugins');
 require('esbuild').buildSync({entryPoints:[path.join(source,'main.ts')],nodePaths:[path.resolve('node_modules')],bundle:true,platform:'node',format:'cjs',target:'es2018',external:['obsidian','electron','@codemirror/*','@lezer/*'],outfile:path.join(target,'enhanced-canvas/main.js')});
 for(const file of ['manifest.json','styles.css'])fs.copyFileSync(path.join(source,file),path.join(target,'enhanced-canvas',file));
 for(const file of ['main.js','manifest.json','styles.css'])fs.copyFileSync(file,path.join(target,'canvas-mind-map',file));
 await page.evaluate(async()=>{await app.plugins.loadManifests();});
 const runtimeErrors=[];page.on('pageerror',error=>runtimeErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')console.error('HOST:',message.text());});
 const results=[];
 for(const order of [['enhanced-canvas','canvas-mind-map'],['canvas-mind-map','enhanced-canvas']]){
  results.push(await page.evaluate(async order=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(const id of ['canvas-mind-map','enhanced-canvas'])if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);
   const stamp=Date.now(),boardName=`Coexist-${stamp}`,aName=`Source-${stamp}`,bName=`Target-${stamp}`;
   const a=await app.vault.create(aName+'.md','---\ncustom: preserve-me\n---\n# Root\n\nIntroduction.\n\n## Alpha\n\nBody alpha.\n\n## Beta\n\nBody beta.\n');
   const b=await app.vault.create(bName+'.md','# Target\n\nTarget body.\n');
   const ordinary=await app.vault.create(`Ordinary-${stamp}.md`,'---\ncustom: ordinary-value\n---\n# Ordinary\n\nIndependent file card.\n');
   const file=await app.vault.create(boardName+'.canvas',JSON.stringify({nodes:[
    {id:'source',type:'file',file:a.path,x:0,y:0,width:300,height:200},
    {id:'target',type:'file',file:b.path,x:700,y:0,width:300,height:200},
    {id:'ordinary',type:'file',file:ordinary.path,x:700,y:400,width:300,height:200},
    {id:'ecsource',type:'text',text:'# EC Root\n\n## EC Child A\n\n## EC Child B',x:0,y:600,width:300,height:200},
    {id:'sentinel',type:'text',text:'Unrelated card',x:1000,y:700,width:250,height:100,thirdParty:{keep:true}}
   ],edges:[{id:'external',fromNode:'source',fromSide:'right',toNode:'target',toSide:'left'},{id:'ordinary-edge',fromNode:'ordinary',fromSide:'right',toNode:'target',toSide:'left'}]}));
   const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);await wait(400);
   for(const id of order)await app.plugins.enablePlugin(id);await wait(1000);
   const ec=app.plugins.plugins['enhanced-canvas'],plugin=app.plugins.plugins['canvas-mind-map'];
   if(!ec||!plugin)throw Error('Both plugins must load: '+JSON.stringify({ec:!!ec,cmm:!!plugin,installed:Object.keys(app.plugins.manifests)}));
   if(!ec.settings.enableFrontmatter||!ec.settings.enableCustomCSS)throw Error('Test requires Enhanced Canvas default features enabled');
   const canvas=leaf.view.canvas;
   class Menu{constructor(){this.items=[];}setSectionSubmenu(){return this;}addItem(fn){const i={setTitle(v){this.title=v;return this;},setIcon(){return this;},setSection(){return this;},setWarning(){return this;},setDisabled(){return this;},setChecked(){return this;},onClick(fn){this.action=fn;return this;},setSubmenu(){return this.child=new Menu();}};fn(i);this.items.push(i);return this;}addSeparator(){return this;}}
   const menu=new Menu();canvas.nodes.get('source').showMenu(menu);
   if(menu.items.filter(i=>i.title==='Split by headings').length!==1)throw Error('Enhanced Canvas menu missing or duplicated');
   if(menu.items.filter(i=>/生成可折叠|Generate collapsible/.test(i.title)).length!==1)throw Error('Mind Map menu missing or duplicated');
   await ec.exploder.split(canvas,canvas.nodes.get('ecsource'));await wait(800);
   if(canvas.nodes.has('ecsource'))throw Error('Enhanced Canvas heading split did not work');
   const splitNodes=[...canvas.nodes.values()].filter(n=>n.text?.includes('EC Child'));
   if(splitNodes.length<2)throw Error('Enhanced Canvas split children missing');
   await plugin.mindmap.generate(canvas,canvas.nodes.get('source'),'title','right');await wait(1000);
   const root=[...canvas.nodes.values()].find(n=>n.getData().canvasMindMap?.depth===0);if(!root)throw Error('Mind Map generation failed');
   const managed=()=>canvas.getData().nodes.filter(n=>n.canvasMindMap?.nodeId===n.id);
   const ids=managed().map(n=>n.id).sort();if(ids.length!==3)throw Error('Mind Map hierarchy changed');
   plugin.mindmap.fold(canvas,root.id,false);await wait(200);
   if(!leaf.view.contentEl.querySelector('.cmm-mindmap-hidden'))throw Error('Mind Map folding failed');
   plugin.mindmap.fold(canvas,root.id,true);await wait(250);
   plugin.mindmap.branchAppearance(canvas,root.id);await wait(200);
   // Let Enhanced Canvas property synchronization run with the newly generated graph.
   await ec.syncAllCanvasProperties();await wait(700);
   const text=await app.vault.read(a);
   if(!text.includes('custom: preserve-me')||!text.includes('Body alpha.'))throw Error('Existing source content was lost');
   const fm=app.metadataCache.getFileCache(ordinary)?.frontmatter;
   if(!fm?.canvas)throw Error('Enhanced Canvas ordinary-file backlink missing');
   const links=fm[boardName];if(!JSON.stringify(links).includes(bName))throw Error('Enhanced Canvas edge-link property was lost');
   if(fm.custom!=='ordinary-value')throw Error('Ordinary custom frontmatter changed');
   const sentinel=canvas.getData().nodes.find(n=>n.id==='sentinel');if(!sentinel?.thirdParty?.keep)throw Error('Foreign metadata was lost');
   if(!canvas.getData().edges.some(e=>e.id==='external'&&e.toNode==='target'))throw Error('External edge lost');
   canvas.requestSave();await leaf.view.save();await wait(250);
   const disk=JSON.parse(await app.vault.read(file));
   if(JSON.stringify(disk.nodes.filter(n=>n.canvasMindMap?.nodeId===n.id).map(n=>n.id).sort())!==JSON.stringify(ids))throw Error('Mind Map metadata changed on save');
   const next=app.workspace.getLeaf('tab');await next.openFile(file);await wait(700);
   const reopened=next.view.canvas;
   if(!reopened.nodes.get('sentinel')?.getData().thirdParty.keep)throw Error('Foreign metadata not restored');
   const before=canvas.requestSave;
   await app.plugins.disablePlugin('enhanced-canvas');await wait(300);
   if(canvas.requestSave!==before)throw Error('Enhanced Canvas unload removed Mind Map hooks');
   app.workspace.setActiveLeaf(leaf,{focus:true});await wait(200);
   plugin.mindmap.fold(canvas,root.id,false);await wait(200);
   if(!leaf.view.contentEl.querySelector('.cmm-mindmap-hidden'))throw Error('Mind Map broken after Enhanced Canvas unload: '+JSON.stringify({data:canvas.getData().nodes.map(n=>({id:n.id,meta:n.canvasMindMap})),rootId:root.id,leafLive:leaf.view.canvas===canvas,stopped:plugin.mindmap.stopped}));
   await app.plugins.enablePlugin('enhanced-canvas');await wait(500);
   await app.plugins.disablePlugin('canvas-mind-map');
   const menuAfter=new Menu();reopened.nodes.get('sentinel').showMenu(menuAfter);
   if(menuAfter.items.filter(i=>i.title==='Split by headings').length!==1)throw Error('Enhanced Canvas broken after Mind Map unload');
   await app.plugins.enablePlugin('canvas-mind-map');await wait(500);
   return {order,enhancedVersion:ec.manifest.version,mapNodes:ids.length,enhancedSplit:true,fileCardFrontmatter:true,textMapPropertySync:false,externalEdges:true,foreignMetadata:true,reopen:true,independentUnload:true};
  },order));
 }
 assert.deepEqual(runtimeErrors,[]);
 fs.mkdirSync('tmp/enhanced-coexist-live-results',{recursive:true});
 fs.writeFileSync('tmp/enhanced-coexist-live-results/report.json',JSON.stringify(results,null,2));
 console.log('PASS Enhanced Canvas coexistence:',JSON.stringify(results));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
