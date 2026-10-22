const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const {chromium}=require('./lib/browser.cjs').requireTooling('Enhanced Canvas legacy coexistence');
(async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:9238');try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('index.html'));
 const vault=path.resolve('tmp/enhanced-coexist-live');assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),vault);
 await page.evaluate(async()=>{for(const id of ['canvas-mind-map','enhanced-canvas'])if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);});
 const source=process.env.CMM_LEGACY_ENHANCED_SOURCE||'D:/enhanced canvas/obsidian-enhanced-canvas';
 const target=path.join(vault,'.obsidian/plugins/enhanced-canvas');
 esbuild.buildSync({entryPoints:[path.join(source,'main.ts')],nodePaths:[path.resolve('node_modules')],bundle:true,platform:'node',format:'cjs',target:'es2018',external:['obsidian','electron','@codemirror/*','@lezer/*'],outfile:path.join(target,'main.js')});
 for(const file of ['manifest.json','styles.css'])fs.copyFileSync(path.join(source,file),path.join(target,file));
 for(const file of ['main.js','manifest.json','styles.css'])fs.copyFileSync(file,path.join(vault,'.obsidian/plugins/canvas-mind-map',file));
 await page.evaluate(async()=>{await app.plugins.loadManifests();});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const results=[];
 for(const order of [['enhanced-canvas','canvas-mind-map'],['canvas-mind-map','enhanced-canvas']]){
  results.push(await page.evaluate(async order=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(const id of ['canvas-mind-map','enhanced-canvas'])if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);
   const f=await app.vault.create(`Legacy-coexist-${Date.now()}.canvas`,JSON.stringify({nodes:[{id:'legacy-source',type:'text',text:'# Legacy root\n\n## First\n\n## Second',x:0,y:0,width:300,height:180,foreign:{keep:true}},{id:'untouched',type:'text',text:'Other card',x:900,y:0,width:250,height:100}],edges:[]}));
   const leaf=app.workspace.getLeaf('tab');await leaf.openFile(f);await wait(250);
   for(const id of order)await app.plugins.enablePlugin(id);await wait(650);
   const ec=app.plugins.plugins['enhanced-canvas'],cmm=app.plugins.plugins['canvas-mind-map'];
   if(!ec?.mindmap||!cmm)throw Error('Both legacy Enhanced Canvas and Canvas Mind Map must be loaded');
   const canvas=leaf.view.canvas;
   await ec.mindmap.generate(canvas,canvas.nodes.get('legacy-source'),'title');await wait(400);
   const legacyNodes=canvas.getData().nodes.filter(n=>n.enhancedCanvasMindmap);
   if(legacyNodes.length!==3)throw Error('Legacy Enhanced Canvas generation failed');
   const root=legacyNodes.find(n=>n.enhancedCanvasMindmap.depth===0);
   ec.mindmap.fold(canvas,root.id,false);await wait(150);
   class Menu{constructor(){this.items=[];}setSectionSubmenu(){return this;}addItem(fn){const i={setTitle(v){this.title=v;return this;},setIcon(){return this;},setSection(){return this;},setWarning(){return this;},setDisabled(){return this;},setChecked(){return this;},onClick(fn){this.action=fn;return this;},setSubmenu(){return this.child=new Menu();}};fn(i);this.items.push(i);return this;}addSeparator(){return this;}}
   const menu=new Menu();cmm.mindmap.addMenu(menu,canvas.nodes.get(root.id));
   const migrate=menu.items.find(i=>/迁移此导图|Migrate this map/.test(i.title));if(!migrate)throw Error('No explicit legacy migration action');
   if(menu.items.some(i=>/生成可折叠|Generate collapsible/.test(i.title)))throw Error('Legacy graph offered duplicate generation');
   const snapshot=canvas.getData(),ids=legacyNodes.map(n=>n.id).sort();
   migrate.action();await wait(350);
   const migrated=canvas.getData().nodes.filter(n=>n.canvasMindMap);
   if(JSON.stringify(migrated.map(n=>n.id).sort())!==JSON.stringify(ids))throw Error('Migration changed node IDs');
   if(migrated.some(n=>n.enhancedCanvasMindmap))throw Error('Both engines still own the migrated graph');
   for(const old of snapshot.nodes){const now=canvas.getData().nodes.find(n=>n.id===old.id);if(!now||now.text!==old.text||now.x!==old.x||now.y!==old.y||now.width!==old.width)throw Error('Migration changed geometry or content');}
   if(!leaf.view.contentEl.querySelector('.cmm-mindmap-hidden'))throw Error('Migrated fold state missing');
   const oldMenu=new Menu();ec.mindmap.addMenu(oldMenu,canvas.nodes.get(root.id));if(oldMenu.items.length)throw Error('Legacy engine adds commands to a migrated graph');
   const before=JSON.stringify(canvas.getData());await ec.mindmap.generate(canvas,canvas.nodes.get(root.id),'title');if(JSON.stringify(canvas.getData())!==before)throw Error('Legacy engine re-generated a migrated graph');
   canvas.undo();await wait(250);
   if(canvas.getData().nodes.filter(n=>n.enhancedCanvasMindmap).length!==3)throw Error('Undo did not restore legacy ownership');
   cmm.mindmap.migrateEnhancedMap(canvas,root.id);await wait(200);
   canvas.requestSave();await leaf.view.save();
   const next=app.workspace.getLeaf('tab');await next.openFile(f);await wait(500);
   if(next.view.canvas.getData().nodes.filter(n=>n.canvasMindMap).length!==3)throw Error('Migrated data did not survive reopen');
   await app.plugins.disablePlugin('enhanced-canvas');await wait(200);app.workspace.setActiveLeaf(next,{focus:true});
   cmm.mindmap.fold(next.view.canvas,root.id,true);await wait(100);cmm.mindmap.fold(next.view.canvas,root.id,false);await wait(100);
   if(!next.view.contentEl.querySelector('.cmm-mindmap-hidden'))throw Error('Migrated folding depends on Enhanced Canvas');
   return {order,version:ec.manifest.version,legacyGeneration:true,explicitMigration:true,stableNodeIds:true,foldState:true,undo:true,reopen:true,singleOwner:true};
  },order));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync('tmp/enhanced-coexist-live-results/legacy-report.json',JSON.stringify(results,null,2));
 console.log('PASS local Enhanced Canvas legacy coexistence:',JSON.stringify(results));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
