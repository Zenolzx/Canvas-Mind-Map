const assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
const out=esbuild.buildSync({entryPoints:['src/native/EnhancedCanvasMigration.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const env={module:{exports:{}},exports:{}};vm.runInNewContext(out.outputFiles[0].text,env);
const {migrateEnhancedCanvasMap}=env.module.exports;
const metadata=(id,depth,parentId)=>({version:1,nodeId:id,rootId:'root',depth,parentId,key:id,title:id,expanded:depth===0,angle:0,placed:true,mode:'title',style:{width:250,height:60,autoHeight:true,color:'2'},applied:{width:250,height:60,color:'2'},overrides:{color:true}});
const source={nodes:[{id:'root',type:'text',text:'Root',x:0,y:0,width:250,height:60,enhancedCanvasMindmap:{...metadata('root',0),source:{file:'Note.md'}},other:{keep:true}},{id:'child',type:'text',text:'Child',x:350,y:0,width:250,height:60,enhancedCanvasMindmap:metadata('child',1,'root')},{id:'foreign',type:'text',text:'Unrelated',x:800,y:0,width:200,height:60}],edges:[{id:'tree',fromNode:'root',toNode:'child',enhancedCanvasMindmapRoot:'root'},{id:'external',fromNode:'child',toNode:'foreign',label:'keep'}]};
const before=JSON.stringify(source),migrated=migrateEnhancedCanvasMap(source,'child');
assert.equal(JSON.stringify(source),before,'input and the undo snapshot must stay untouched');
assert.deepEqual(JSON.parse(JSON.stringify(migrated.nodes.map(n=>({id:n.id,x:n.x,y:n.y,text:n.text})))),source.nodes.map(n=>({id:n.id,x:n.x,y:n.y,text:n.text})));
assert.equal(migrated.nodes[0].canvasMindMap.source.file,'Note.md');assert.equal(migrated.nodes[1].canvasMindMap.expanded,false);
assert.equal(migrated.nodes[0].canvasMindMap.overrides.color,true);assert.equal(migrated.nodes[0].other.keep,true);
assert.equal(migrated.edges[0].canvasMindMapRoot,'root');assert.equal(migrated.edges[0].enhancedCanvasMindmapRoot,undefined);
assert.deepEqual(JSON.parse(JSON.stringify(migrated.edges[1])),source.edges[1]);
for(const mutate of [d=>d.nodes[1].enhancedCanvasMindmap.parentId='missing',d=>d.nodes[1].enhancedCanvasMindmap.depth=3,d=>d.nodes[0].canvasMindMap={},d=>d.edges[0].toNode='foreign']){
 const bad=JSON.parse(before);mutate(bad);const snapshot=JSON.stringify(bad);assert.throws(()=>migrateEnhancedCanvasMap(bad,'root'));assert.equal(JSON.stringify(bad),snapshot);
}
assert.throws(()=>migrateEnhancedCanvasMap(migrated,'root'),'repeated migration is rejected');
console.log('PASS Enhanced Canvas migration: stable IDs/geometry/content, preserved source/folds/custom metadata/edges, atomic rejection and no double ownership');
