const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const dir=path.resolve('tmp/composer-browser');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'obsidian.cjs'),`
const base=require('../../scripts/organic-browser-obsidian.cjs');Object.assign(exports,base);
exports.ItemView=class extends base.ItemView {
 constructor(leaf){super(leaf);this.leaf=leaf;this.cleanups=[];}
 register(fn){this.cleanups.push(fn);}
 registerDomEvent(el,type,fn,options){el.addEventListener(type,fn,options);this.register(()=>el.removeEventListener(type,fn,options));}
};
exports.TFolder=class{constructor(path){this.path=path;}};
// Obsidian owns YAML parsing. The fixture exposes representative mapping/scalar/error results.
exports.parseYaml=value=>value==='status: draft'?{status:'draft'}:JSON.parse(value);
exports.Menu=class {
 constructor(){this.items=[];}
 addItem(build){const item={setTitle(title){this.title=title;return this;},setChecked(){return this;},setDisabled(value){this.disabled=value;return this;},setIcon(){return this;},onClick(fn){this.action=fn;return this;},setSubmenu(){return this.submenu=new exports.Menu();}};build(item);this.items.push(item);return this;}
 addSeparator(){return this;}
 showAtMouseEvent(){document.querySelectorAll('.test-menu').forEach(el=>el.remove());const el=document.createElement('div');el.className='test-menu';el.setAttribute('role','menu');for(const item of this.items){const button=document.createElement('button');button.setAttribute('role','menuitem');button.textContent=item.title;button.disabled=!!item.disabled;button.onclick=()=>{el.remove();if(item.submenu)item.submenu.showAtMouseEvent();else item.action?.();};el.append(button);}document.body.append(el);}
};
`);
const source=`
import {ComposerView} from './src/composer/ComposerView';
import {ComposerStore} from './src/composer/ComposerStore';
import {fromTemplate} from './src/composer/ComposerTools';
import {OrganicMindMapView} from './src/organic/OrganicMindMapView';
import {ObsidianDocumentHost} from './src/writing/ObsidianDocumentHost';
import {TFile,TFolder} from 'obsidian';
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.setText=function(text){this.textContent=text;};
HTMLElement.prototype.addClass=function(...names){this.classList.add(...names);};
HTMLElement.prototype.removeClass=function(...names){this.classList.remove(...names);};
HTMLElement.prototype.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.text)el.textContent=options.text;if(options.cls)el.className=options.cls;for(const key of ['type','value'])if(options[key]!==undefined)el.setAttribute(key,options[key]);for(const [key,value] of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el;};
HTMLElement.prototype.createDiv=function(options){return this.createEl('div',options);};
HTMLElement.prototype.createSpan=function(options){return this.createEl('span',options);};
const files=new Map(), contents=new Map();files.set('/',new TFolder('/'));files.set('Projects',new TFolder('Projects'));
let disk={},writes=0,created=0,handoff=null,fail=false;
const store=new ComposerStore(undefined,async()=>{if(fail)throw new Error('disk full');disk=JSON.parse(JSON.stringify(store.data));writes++;});
const app={scope:{},vault:{on(){},getAbstractFileByPath:p=>files.get(p),read:async f=>contents.get(f.path),process:async(f,fn)=>{const text=fn(contents.get(f.path));contents.set(f.path,text);return text;},create:async(p,text)=>{if(files.has(p))throw new Error('File exists');const f=new TFile(p);files.set(p,f);contents.set(p,text);created++;return f;}},workspace:{requestSaveLayout(){},getLeavesOfType(){return[];},iterateAllLeaves(){},getLeaf(){return{openFile:async()=>{}}}}};
const host=new ObsidianDocumentHost(app);
const leaf={app,setViewState:async state=>{await view.onClose();view.contentEl.remove();const organic=new OrganicMindMapView(leaf,undefined,()=>({animation:false,autoRefresh:false}),host);leaf.view=organic;await organic.onOpen();await organic.setState(state.state,{history:false});handoff=state;},detach(){}};
const view=new ComposerView(leaf,store);
(async()=>{await view.onOpen();await view.setState({targetFolder:'Projects'},{history:false});view.focusMap();window.composerTest={view,store,files,contents,getDisk:()=>disk,getWrites:()=>writes,getCreated:()=>created,getHandoff:()=>handoff,setFail:v=>{fail=v;},seedFile:(path,text)=>{files.set(path,new TFile(path));contents.set(path,text);},seedTemplate:async key=>{const draft=fromTemplate(key,'Projects');store.put(draft);await view.setState({draftId:draft.draftId},{history:false});view.focusMap();}};window.ready=true;})();
`;
esbuild.buildSync({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',platform:'browser',target:'chrome110',alias:{obsidian:path.join(dir,'obsidian.cjs'),'@codemirror/state':path.resolve('node_modules/@codemirror/state/dist/index.js')},outfile:path.join(dir,'test.js')});
fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px Arial;background:#fffaf4;--background-primary:#fffaf4;--background-secondary:#f4eee5;--background-modifier-border:#ddd;--text-normal:#333;--text-muted:#777;--interactive-accent:#287e83;--text-error:#b33}.test-modal{position:fixed;inset:8% 15%;z-index:99;background:white;border:1px solid;padding:24px;overflow:auto}.test-menu{position:fixed;right:20px;top:50px;z-index:100;background:white;padding:8px;border:1px solid #ddd}.test-menu button{display:block;width:100%;text-align:left}button{cursor:pointer}${fs.readFileSync('styles.css','utf8')}</style></head><body><script src="test.js"></script></body></html>`);
console.log('Built Composer browser fixture');
