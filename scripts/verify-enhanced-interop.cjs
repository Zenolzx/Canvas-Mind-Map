const assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
const out=esbuild.buildSync({entryPoints:['src/native/EnhancedCanvasInterop.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['monkey-around']});
const env={module:{exports:{}},exports:{},require};vm.runInNewContext(out.outputFiles[0].text,env);
const {EnhancedCanvasInterop}=env.module.exports;
let calls=0;const legacy=()=>({addMenu(){calls++;return 'menu';},generate(){calls++;return 'generated';}});
const first=legacy(),original=first.generate,app={plugins:{plugins:{'enhanced-canvas':{mindmap:first}}}},interop=new EnhancedCanvasInterop(app);
const own={getData:()=>({id:'root',canvasMindMap:{version:1,nodeId:'root',rootId:'root',depth:0,key:'root',title:'Root',expanded:true,angle:0,placed:true,mode:'title',style:{},applied:{}}})};
const foreign={getData:()=>({id:'foreign'})};
interop.refresh();interop.refresh();
assert.equal(first.generate({},foreign),'generated');assert.equal(first.addMenu({},foreign),'menu');
const before=calls;first.generate({},own);first.addMenu({},own);assert.equal(calls,before,'legacy engine must leave current maps alone');
delete app.plugins.plugins['enhanced-canvas'];interop.refresh();assert.equal(first.generate,original,'disabling restores original method');
const second=legacy();app.plugins.plugins['enhanced-canvas']={mindmap:second};interop.refresh();
const later=calls;second.generate({},own);assert.equal(calls,later,'re-enabled engine is protected');
interop.close();assert.equal(second.generate({},own),'generated','unload restores legacy behavior');
app.plugins.plugins['enhanced-canvas']={};interop.refresh();interop.close();
console.log('PASS Enhanced Canvas interop: own/foreign maps, idempotent refresh, disable/re-enable and unload restoration');

