const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
const output = esbuild.buildSync({entryPoints:['src/CanvasMindmap.ts'], bundle:true, platform:'node', format:'cjs', external:['obsidian','monkey-around'], write:false});
const sandbox = {module:{exports:{}}, exports:{}, console, require:name => name === 'obsidian' ? {FuzzySuggestModal:class {}, Notice:class {}} : {}};
vm.runInNewContext(output.outputFiles[0].text,sandbox);
class Menu {
    constructor(submenus = true) { this.items = []; this.submenus = submenus; }
    addItem(build) {
        const item = {setTitle(title){this.title=title;return this;},setSection(){return this;},setDisabled(){return this;},onClick(action){this.action=action;return this;}};
        if (this.submenus) item.setSubmenu = () => item.children = new Menu();
        this.items.push(item); build(item); return this;
    }
    addSeparator() {this.items.push({separator:true});return this;}
}
const feature = new sandbox.module.exports.CanvasMindmap({settings:{}, app:{}});
const calls = []; feature.run = action => action();
for (const method of ['center','focusBranch','exitFocus','overview','search','fold','depthDialog','relayout','layoutDialog','styleDialog','applyTemplate','branchAppearance','restoreNodeTemplate','refresh'])
    feature[method] = () => calls.push(method);
const canvas = {readonly:false};
const node = {id:'root',canvas,getData:()=>({id:'root',canvasMindMap:{version:1,rootId:'root',nodeId:'root',depth:0,key:'',title:'root',expanded:true,angle:0,style:{},applied:{}}})};
const menu = new Menu(); feature.addMenu(menu,node);
const titles = menu.items.filter(i=>i.title).map(i=>i.title);
assert.deepEqual(titles, ['Return to mind map center','Focus branch','Show mind map overview','Search titles (including folded nodes)…','Expand / Collapse','Layout','Appearance','Refresh mind map from source note']);
const count = menu.items.length; feature.addMenu(menu,node); assert.equal(menu.items.length,count,'deduplication');
const invoke = menu => {for(const item of menu.items) {if(item.action)item.action(); if(item.children)invoke(item.children);}};
invoke(menu); assert.equal(calls.length,14); assert.ok(calls.includes('restoreNodeTemplate'));
const fallback = new Menu(false); feature.addMenu(fallback,node); calls.length=0;invoke(fallback);assert.equal(calls.length,14,'all actions survive unavailable submenu API');
canvas.readonly=true;const readonly=new Menu();feature.addMenu(readonly,node);calls.length=0;invoke(readonly);
assert.deepEqual(calls,['center','focusBranch','overview','search']);
console.log('PASS: Native menu groups/actions, deduplication, readonly and submenu fallback.');
