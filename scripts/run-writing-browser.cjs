const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchOptions, requireTooling } = require('./lib/browser.cjs');
const { expectScreenshot } = require('./lib/visual.cjs');
const { chromium } = requireTooling('Writing browser');
(async()=>{
 const browser=await chromium.launch(launchOptions());
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>console.error('PAGE ERROR',error.message));
  await page.goto(pathToFileURL(path.resolve('tmp/writing-browser/index.html')).href);
  await page.waitForFunction(()=>window.testDone||window.testError,{},{timeout:30000});
  console.log(await page.locator('#report').textContent());
  if(!await page.evaluate(()=>!!window.testError)) {
   const blank=await page.evaluate(()=>{
    const svg=window.writingTest.view.svg,r=svg.getBoundingClientRect();
    for(let y=r.top+10;y<r.bottom-40;y+=20)for(let x=r.left+10;x<r.right-40;x+=20)
     if(document.elementFromPoint(x,y)===svg)return {x,y};
   });
   if(!blank)throw new Error('No map background for pan regression');
   await page.mouse.move(blank.x,blank.y);await page.mouse.down();await page.mouse.move(blank.x+35,blank.y+24,{steps:5});await page.mouse.up();
   await page.evaluate(async()=>{
    const v=window.writingTest.view, before=JSON.stringify({offset:v.offset,scale:v.scale});
    for(const id of v.writing.document.order.slice(0,3))await v.writing.select(id);
    if(JSON.stringify({offset:v.offset,scale:v.scale})!==before)throw new Error('Real background pan jumped after heading selection');
    const expected='translate('+v.offset.x+' '+v.offset.y+') scale('+v.scale+')';
    if(v.scene.getAttribute('transform')!==expected)throw new Error('DOM and canonical viewport diverged');
   });
   console.log('PASS real background pointer pan followed by multiple heading selections');
   async function point(title, ratio=.5) {
    return page.evaluate(({title,ratio})=>{
     const view=window.writingTest.view;
     const section=Array.from(view.writing.document.sections.values()).find(s=>s.headingText===title);
     const group=Array.from(view.scene.querySelectorAll('[data-node-id]')).find(g=>g.getAttribute('data-node-id')===section.id);
     const rect=group.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height*ratio};
    },{title,ratio});
   }
   /**
    * Resolve both ends of a drag inside a single evaluation. A bounding box is not enough: the
    * box can extend past the painted surface, and the box centre then resolves to nothing, so the
    * controller silently ignores the drop. For the drop end, search the target's own box for a
    * point that actually hit-tests to it and prefer the requested band, so the zone (before /
    * child / after) still follows the requested ratio.
    */
   async function gesturePoints(source,target,ratio) {
    return page.evaluate(({source,target,ratio})=>{
     const view=window.writingTest.view;
     const groupOf=title=>{
      const section=Array.from(view.writing.document.sections.values()).find(s=>s.headingText===title);
      if(!section)return null;
      const group=Array.from(view.scene.querySelectorAll('[data-node-id]')).find(g=>g.getAttribute('data-node-id')===section.id);
      return group?{group,id:section.id}:null;
     };
     const hits=(point,id)=>{
      const at=view.svg.ownerDocument.elementFromPoint(point.x,point.y);
      return at?.closest?.('[data-node-id]')?.getAttribute('data-node-id')===id;
     };
     const sourceGroup=groupOf(source),targetGroup=groupOf(target);
     const svg=view.svg.getBoundingClientRect();
     if(!sourceGroup||!targetGroup)return {surface:{x:svg.x,y:svg.y,w:svg.width,h:svg.height},scale:view.scale};
     const sr=sourceGroup.group.getBoundingClientRect();
     const start={x:sr.x+sr.width/2,y:sr.y+sr.height/2};
     const tr=targetGroup.group.getBoundingClientRect();
     // Candidate bands, ordered by how close they are to the requested ratio.
     const bands=[ratio,.5,1-ratio,.28,.72,.15,.85];
     let drop;
     for(const band of bands){
      const candidate={x:tr.x+tr.width/2,y:tr.y+tr.height*band};
      if(hits(candidate,targetGroup.id)){drop=candidate;break;}
     }
     return {start,drop,startHits:hits(start,sourceGroup.id),
      box:{x:tr.x,y:tr.y,w:tr.width,h:tr.height},surface:{x:svg.x,y:svg.y,w:svg.width,h:svg.height},scale:view.scale};
    },{source,target,ratio});
   }
   async function drag(source,target,ratio,valid=true) {
    // Each drag changes the document, which changes the layout bounds. Without re-fitting and
    // letting the viewport settle, a node can end up outside the visible surface, and a drop
    // aimed at a box that is off-canvas resolves to nothing and is silently ignored.
    await page.evaluate(async()=>{
     const v=window.writingTest.view;v.collapsed.clear();
     for(let i=0;i<3;i++){v.draw();v.fit();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
    });
    await page.waitForTimeout(150);
    const ends=await gesturePoints(source,target,ratio);
    const start=ends.start, targetPoint=ends.drop;
    if(!start||!targetPoint)throw new Error(`drag ${source} -> ${target}: the drop target has no hit-testable point; `+
      `box=${JSON.stringify(ends.box)} surface=${JSON.stringify(ends.surface)} scale=${ends.scale?.toFixed(2)}`);
    const writes=await page.evaluate(()=>window.writingTest.getWrites());
    if(process.env.CMM_DRAG_DEBUG) console.log(`  drag ${source}->${target}@${ratio} start=(${start.x.toFixed(0)},${start.y.toFixed(0)}) target=(${targetPoint.x.toFixed(0)},${targetPoint.y.toFixed(0)}) writes=${writes}`);
    // Aim at the verified point. Recomputing here would discard the hit-test check above, and the
    // layout shifts as soon as the pointer moves onto the source, so a fresh calculation could
    // land just outside the target and the drop would be silently ignored.
    await page.mouse.move(start.x,start.y);
    const end=targetPoint;
    await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});
    if(process.env.CMM_DRAG_TRACE) {
     const mid=await page.evaluate(({target,pt})=>{
      const v=window.writingTest.view;
      const s=[...v.writing.document.sections.values()].find(x=>x.headingText===target);
      const g=[...v.scene.querySelectorAll('[data-node-id]')].find(x=>x.getAttribute('data-node-id')===s.id);
      const r=g.getBoundingClientRect();
      const at=v.svg.ownerDocument.elementFromPoint(pt.x,pt.y);
      const stack=[];let el=at,guard=0;
      while(el&&guard++<5){stack.push(`${el.tagName}${el.getAttribute?.('class')?'.'+String(el.getAttribute('class')).split(' ')[0]:''}`);el=el.parentElement;}
      return {nowBox:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
       atTag:at?.tagName,atNode:at?.closest?.('[data-node-id]')?.getAttribute('data-node-id')??null,
       targetId:s.id,pt:{x:Math.round(pt.x),y:Math.round(pt.y)},stack};
     },{target,pt:targetPoint});
     console.log(`  TRACE ${source}->${target}: dropAt=${JSON.stringify(mid.pt)} targetNow=${JSON.stringify(mid.nowBox)} targetId=${mid.targetId} hitAtDrop=${mid.atTag}/${mid.atNode} stack=${mid.stack.join(' < ')}`);
    }
    if(await page.evaluate(()=>window.writingTest.getWrites())!==writes)throw new Error('Drag wrote Markdown before drop');
    const preview=await page.locator('.cmm-writing-drop-preview').textContent();
    if(valid&&preview.includes('不可放置'))throw new Error(preview);
    if(!valid&&!preview.includes('不可放置'))throw new Error('Cycle preview must be invalid');
    await page.mouse.up();
    if(valid) {
     try { await page.waitForFunction(count=>window.writingTest.getWrites()>count,writes,{timeout:5000}); }
     catch {
      const diag=await page.evaluate(()=>({writes:window.writingTest.getWrites(),
       busy:!!window.writingTest.view.writing.busy, input:!!window.writingTest.view.writing.input,
       editorDirty:window.writingTest.view.writing.editor.dirty,
       error:window.writingTest.view.writing.lastError||null}));
      throw new Error(`drop on ${source} -> ${target} wrote nothing: ${JSON.stringify(diag)} preview=${JSON.stringify(preview)} start=(${start.x.toFixed(0)},${start.y.toFixed(0)}) end=(${end.x.toFixed(0)},${end.y.toFixed(0)})`);
     }
    }
    else {await page.waitForTimeout(100);if(await page.evaluate(()=>window.writingTest.getWrites())!==writes)throw new Error('Invalid drop wrote file');}
   }
   await drag('Results','Introduction',.1);
   await drag('Results','Background',.5);
   await drag('Results','Conclusion',.9);
   await drag('Background','Child',.5,false);
   console.log('PASS real pointer Before / Make child / After, no writes during drag, cycle rejection');
  }
  await page.screenshot({animations: 'disabled', path:'tmp/writing-browser/result.png',fullPage:true});
  expectScreenshot('writing-result', await page.screenshot({animations: 'disabled',  fullPage: true }));
  if(await page.evaluate(()=>!!window.testError))process.exitCode=1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
