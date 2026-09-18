const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const destination = path.resolve('tmp/writing-browser'); fs.mkdirSync(destination, { recursive: true });
const source = `
import { OrganicMindMapView } from './src/organic/OrganicMindMapView';
import { ObsidianDocumentHost } from './src/writing/ObsidianDocumentHost';
import { TFile, MarkdownView, editorInfoField } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
    prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
}
HTMLElement.prototype.empty = function(){this.replaceChildren();};
HTMLElement.prototype.addClass = function(name){this.classList.add(name);};
HTMLElement.prototype.removeClass = function(name){this.classList.remove(name);};
HTMLElement.prototype.createEl = function(tag, options = {}) {
 const el = document.createElement(tag); if(options.text)el.textContent=options.text;if(options.cls)el.className=options.cls;
 for(const key of ['type','value']) if(options[key])el.setAttribute(key,options[key]);
 for(const [key,value] of Object.entries(options.attr || {}))el.setAttribute(key,value);
 this.append(el);return el;
};
HTMLElement.prototype.createDiv = function(options){return this.createEl('div',options);};
HTMLElement.prototype.createSpan = function(options){return this.createEl('span',options);};
const log = text => {document.getElementById('report').append(document.createTextNode(text+'\\n'));};
const assert = (ok, message) => { if(!ok)throw new Error(message); };
const tick = () => new Promise(resolve=>setTimeout(resolve,20));
async function until(fn) {for(let i=0;i<100;i++){if(fn())return;await tick();}throw new Error('Timed out');}
async function run(){
 let source='', writes=0; const file = new TFile('Article.md'); const events = new Map();
 const app={scope:{},vault:{read:async()=>source,getAbstractFileByPath:path=>path===file.path?file:null,
 process:async(file,fn)=>{const next=fn(source);await tick();source=next;writes++;for(const listener of events.get('modify')||[])listener(file);return source;},
 on:(name,listener)=>{events.set(name,[...(events.get(name)||[]),listener]);return listener;}},
 workspace:{requestSaveLayout(){},getLeavesOfType:()=>[],iterateAllLeaves(){}}};
 const host=new ObsidianDocumentHost(app);
 const view=new OrganicMindMapView({app},undefined,()=>({animation:false,autoRefresh:true}),host);
 await view.onOpen();await view.loadSource(file);await view.toggleWriting();
 const w=view.writing;assert(w,'Writing mode opened');assert(w.document.order.length===0,'empty document');
 const id=title=>Array.from(w.document.sections.values()).find(s=>s.headingText===title)?.id;
 const titleInput=()=>view.contentEl.querySelector('.cmm-writing-inline');
 async function commitTitle(title,key='Enter'){
   await until(()=>titleInput()&&!titleInput().disabled);const input=titleInput();input.value=title;
   input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
   await until(()=>!!id(title)&&!w.busy);await tick();
 }
 await w.inline('child');
 for(const title of ['Introduction','Background','Method','Results','Conclusion'])await commitTitle(title);
 titleInput().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert(w.document.roots.length===5,'A: five H1 sections');assert(!source.includes('New heading'),'no placeholder source');
 log('PASS A: continuous outline creation and cancelled empty draft');
 await w.select(id('Method'));await w.inline('child');await commitTitle('Architecture');await commitTitle('Training');
 titleInput().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert(w.document.sections.get(id('Method')).children.length===2,'B: child and sibling');log('PASS B: child/sibling workflow');
 await w.inline('rename',id('Architecture'));await commitTitle('System Architecture');
 assert(!titleInput(),'rename does not create a draft');log('PASS C: rename');
 await w.select(id('System Architecture'));
 const cm=w.editor.view;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'Body **format**.\\n\\n> quote\\n'}});
 assert(await w.editor.flush(),'body saved');
 await w.execute({type:'insertChild',nodeId:id('System Architecture'),title:'Child'});
 const raw=w.document.text.slice(w.document.sections.get(id('System Architecture')).body.start,w.document.sections.get(id('System Architecture')).body.end);
 await w.execute({type:'move',nodeId:id('System Architecture'),parentId:id('Background'),index:0});
 assert(w.document.sections.get(id('System Architecture')).parentId===id('Background'),'D: moved parent');
 const moved=w.document.sections.get(id('System Architecture'));assert(w.document.text.slice(moved.body.start,moved.body.end)===raw,'D: exact body');
 assert(moved.children.length===1,'D: child retained');log('PASS D: subtree move preserves body and child');
 await w.select(id('Training'));const geometry=JSON.stringify(view.result.nodes.map(n=>[n.id,n.x,n.y]));
 w.editor.view.dispatch({changes:{from:0,to:0,insert:'Training content.\\n'}});assert(await w.editor.flush(),'E: save');
 assert(JSON.stringify(view.result.nodes.map(n=>[n.id,n.x,n.y]))===geometry,'E: body must not relayout');log('PASS E: body save without layout movement');
 source+='\\n# Dataset\\n';await w.externalChange();assert(id('Dataset'),'F: external heading refresh');log('PASS F: external refresh');
 const beforeDelete=source;const deleting=w.remove(id('Method'));await until(()=>document.querySelector('.test-modal'));
 assert(source===beforeDelete,'G: opening delete dialog must not write');
 Array.from(document.querySelectorAll('.test-modal button')).find(b=>b.textContent==='取消').click();await deleting;
 assert(source===beforeDelete,'G: cancel preserves source');log('PASS G: safe delete confirmation');
 const beforeRename=source;await w.execute({type:'rename',nodeId:id('Training'),title:'Train'});await w.history('undo');assert(source===beforeRename,'H: undo exact text');
 await w.history('redo');assert(id('Train'),'H: redo');log('PASS H: structure undo/redo');
 const plan=w.coordinator.prepare({type:'rename',nodeId:id('Train'),title:'Stale'});source+='\\nExternal text\\n';
 let conflict=false;try{await w.coordinator.commit(plan);}catch{conflict=true;}assert(conflict&&!source.includes('Stale'),'I: never overwrite external data');
 await w.refresh();log('PASS I: stale operation rejected');
 await w.select(id('Train'));const current=w.editor.view;const inserted='\\n### Generated\\nNew body';current.dispatch({changes:{from:current.state.doc.length,insert:inserted},selection:{anchor:current.state.doc.length+inserted.length}});
 assert(await w.editor.flush(),'heading body save');assert(id('Generated'),'body creates a heading');
 assert(w.selected===id('Generated'),'cursor follows generated heading');
 w.editor.view.dispatch({changes:{from:w.editor.view.state.doc.length,insert:' continues'}});assert(await w.editor.flush(),'follow-up save');
 assert((source.match(/### Generated/g)||[]).length===1,'no duplicate generated section');log('PASS section range rebind after heading input');
 await w.inline('child');const ime=titleInput();ime.value='中文';ime.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
 assert(!id('中文'),'IME enter must not commit');ime.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 const count=writes;await view.toggleWriting();assert(!view.isWriting&&writes===count,'mode switch no content write');
 await view.toggleWriting();assert(view.isWriting&&view.writing===w,'reenter Edit shares document/history');log('PASS IME guard and View/Edit switching');
 const savedBeforeDraft=source;const draftEditor=w.editor.view;
 draftEditor.dispatch({changes:{from:draftEditor.state.doc.length,insert:'\\n'+'\u0060\u0060\u0060'+'ts\\n# fenced'}});
 assert(!await w.editor.flush(),'unfinished fence must remain an unsaved draft');
 assert(source===savedBeforeDraft&&w.editor.dirty,'failed save preserves source and draft');
 const draftSelection=w.selected;await w.select(id('Introduction'));assert(w.selected===draftSelection,'section switch cannot discard draft');
 w.editor.view.dispatch({changes:{from:w.editor.view.state.doc.length,insert:'\\n'+'\u0060\u0060\u0060'+'\\n'}});
 assert(await w.editor.flush(),'completed fence saves');assert(!id('fenced'),'fenced headings are body');
 log('PASS incomplete Markdown draft protection and successful retry');
 const savedState=view.getState(), oldSelected=w.document.sections.get(w.selected).headingText;
 const restoredView=new OrganicMindMapView({app},undefined,()=>({animation:false,autoRefresh:true}),host);
 await restoredView.onOpen();await restoredView.setState(savedState,{history:false});
 assert(restoredView.isWriting&&restoredView.writing.document.sections.get(restoredView.writing.selected)?.headingText===oldSelected,'restore selected section through fresh IDs');
 assert(restoredView.splitRatio===view.splitRatio,'split ratio restore');
 await restoredView.setState({...savedState,writing:false},{history:false});assert(!restoredView.isWriting,'explicit View state restores reading mode');
 const previousResolver=app.vault.getAbstractFileByPath,otherFile=new TFile('Other.md');
 app.vault.getAbstractFileByPath=path=>path==='Other.md'?otherFile:previousResolver(path);
 await restoredView.setState({file:'Other.md',writing:true},{history:false});
 assert(restoredView.writing.document.sourcePath==='Other.md','changing file must replace old writing session');
 await restoredView.onClose();app.vault.getAbstractFileByPath=previousResolver;
 log('PASS workspace reopen restores Writing mode, selection and split ratio');
 // Real CodeMirror native-peer boundary: delayed saves, write lease, and new input.
 let nativeSource='# Native\\nbody\\n', releaseWrite, writeStarted;
 const nativeFile=new TFile('Native.md'), native=new MarkdownView();native.file=nativeFile;native.editor={};native.getMode=()=> 'source';
 let nativeCM;native.save=async()=>{const captured=nativeCM.state.doc.toString();await tick();nativeSource=captured;};
 const previewNative=new MarkdownView();let previewSource=nativeSource;
 previewNative.file=nativeFile;previewNative.getMode=()=> 'preview';previewNative.getViewData=()=>previewSource;previewNative.setViewData=text=>{previewSource=text;};
 previewNative.save=async()=>{const captured=previewSource;await tick();nativeSource=captured;};
 const nativeApp={workspace:{iterateAllLeaves:fn=>{fn({view:native});fn({view:previewNative});}},vault:{getAbstractFileByPath:()=>nativeFile,read:async()=>nativeSource,
 process:async(file,transform)=>{const result=transform(nativeSource);writeStarted=true;await new Promise(resolve=>releaseWrite=resolve);nativeSource=result;return result;}}};
 const nativeHost=new ObsidianDocumentHost(nativeApp);
 const nativeParent=document.createElement('div');document.body.append(nativeParent);
 nativeCM=new EditorView({parent:nativeParent,state:EditorState.create({doc:nativeSource,extensions:[editorInfoField.init(()=>native),nativeHost.extension]})});
 const hiddenPreviewCM=new EditorView({parent:nativeParent,state:EditorState.create({doc:'# Obsolete hidden source',extensions:[editorInfoField.init(()=>previewNative),nativeHost.extension]})});
 const earlier=native.save();const commit=nativeHost.process('Native.md',current=>{assert(current.editorsSynchronized,'native preflight sync');return '# Renamed\\nbody\\n';});
 await until(()=>writeStarted);const queued=native.save(),queuedPreview=previewNative.save();
 nativeCM.dispatch({changes:{from:0,insert:'blocked during short lease'}});
 assert(nativeCM.state.doc.toString()==='# Native\\nbody\\n','native edit is read-only during lease');
 releaseWrite();await commit;await earlier;await queued;await queuedPreview;
 assert(nativeSource==='# Renamed\\nbody\\n','deferred native save cannot overwrite structure');
 assert(nativeCM.state.doc.toString()===nativeSource,'native peer receives committed text');
 assert(previewSource===nativeSource,'preview and its delayed save receive committed source');
 nativeCM.dispatch({changes:{from:0,insert:'dirty'}});
 let rejected=false;try{await nativeHost.process('Native.md',current=>{if(!current.editorsSynchronized)throw new Error('dirty');return current.text;});}catch{rejected=true;}
 assert(rejected&&nativeSource==='# Renamed\\nbody\\n','dirty peer blocks file write');
 nativeCM.dispatch({changes:{from:0,to:nativeCM.state.doc.length,insert:nativeSource}});
 nativeApp.vault.process=async(file,transform)=>{const next=transform(nativeSource);await tick();nativeSource=next;throw new Error('write succeeded then failed');};
 const uncertain=nativeHost.process('Native.md',()=> '# After failure\\nbody\\n').catch(()=>{});
 await tick();const deferredAfterFailure=native.save();await uncertain;await deferredAfterFailure;
 assert(nativeSource==='# After failure\\nbody\\n'&&nativeCM.state.doc.toString()===nativeSource,'post-write failure must not restore old native buffer');
 log('PASS uncertain host write reconciles evidence without rollback');
 writeStarted=false;
 nativeApp.vault.process=async(file,transform)=>{const next=transform(nativeSource);writeStarted=true;await new Promise(resolve=>releaseWrite=resolve);nativeSource=next;return next;};
 const closingCommit=nativeHost.process('Native.md',()=> '# Closed peer\\nbody\\n');await until(()=>writeStarted);
 let cancelledSave=false;const closingSave=native.save().catch(()=>{cancelledSave=true;});nativeCM.destroy();releaseWrite();await closingCommit;await closingSave;
 assert(cancelledSave&&nativeSource==='# Closed peer\\nbody\\n','closed native view must not replay stale delayed save');
 hiddenPreviewCM.destroy();nativeParent.remove();nativeHost.dispose();log('PASS closing a native peer during commit cancels stale delayed save');
 log('PASS native peer lease, in-flight/deferred saves, synchronization and dirty-buffer rejection');
 // Production View + CodeMirror + real ResizeObserver regression.
 view.viewport.pan(190,-85);view.zoom(1.2,100,100);await tick();
 const viewport=()=>JSON.stringify({offset:view.offset,scale:view.scale});const stable=viewport();
 for(const section of w.document.order.slice(0,4)){await w.select(section);await tick();assert(viewport()===stable,'selection preserves pan/zoom');}
 await w.inline('rename',id('Train'));assert(viewport()===stable,'F2/rename entry preserves viewport');
 titleInput().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 await view.toggleWriting();view.readerVisible=true;view.applySplit();await tick();
 assert(viewport()===stable,'Edit to Reader preserves viewport');
 for(const section of w.document.order.slice(0,4)){await view.navigate(section);await tick();assert(viewport()===stable,'Reader navigation preserves viewport');}
 for(const visible of [false,true,false,true]){view.readerVisible=visible;view.applySplit();await tick();assert(viewport()===stable,'Reader resize preserves viewport');}
 const sourceBefore=source;
 const link=view.readerPane.querySelector('.cmm-reader-child');if(link){link.click();await tick();assert(viewport()===stable,'child navigation preserves viewport');}
 assert(source===sourceBefore,'Reader never writes source');
 await view.toggleWriting();await tick();assert(viewport()===stable,'Reader to Edit preserves viewport');
 assert(view.editorPane.querySelector('.cm-editor'),'Edit retains source editor');
 const session=view.getState();
 const peer=new OrganicMindMapView({app},undefined,()=>({animation:false,autoRefresh:true}),host);
 await peer.onOpen();await peer.setState(session,{history:false});await tick();
 assert(JSON.stringify(peer.viewport.snapshot(peer.svg.clientWidth,peer.svg.clientHeight))===JSON.stringify(session.viewport),'session restores viewport against final split dimensions');
 peer.viewport.pan(-70,40);peer.readerVisible=true;await peer.toggleWriting();peer.applySplit();
 await peer.navigate(peer.writing.document.order.at(-1));await tick();
 assert(viewport()===stable,'second tab cannot change first viewport');
 assert(view.isWriting,'second tab mode is independent');
 await peer.onClose();peer.contentEl.remove();
 log('PASS viewport pan/zoom, selection, Reader children, mode/split resize, rename and read-only Reader');
 window.writingTest={view,app,getSource:()=>source,getWrites:()=>writes};
 log('ALL WRITING BROWSER CHECKS PASSED');window.testDone=true;
}
run().catch(error=>{document.getElementById('report').textContent+='FAIL '+error.stack;window.testError=error.stack;});
`;
esbuild.buildSync({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', platform: 'browser', target: 'chrome110',
 alias: { obsidian: path.resolve('scripts/organic-browser-obsidian.cjs'), '@codemirror/state': path.resolve('node_modules/@codemirror/state/dist/index.js') }, outfile: path.join(destination, 'test.js') });
const css=fs.readFileSync('styles.css','utf8');
fs.writeFileSync(path.join(destination,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;background:#fffaf4;--background-primary:#fffaf4;--background-secondary:#f4eee5;--text-normal:#333;--text-muted:#777;--interactive-accent:#287e83;}#report{white-space:pre-wrap}.test-modal{position:fixed;inset:20%;z-index:99;background:white;border:1px solid;padding:24px}${css}</style></head><body><pre id="report"></pre><script src="test.js"></script></body></html>`);
console.log(path.join(destination,'index.html'));
