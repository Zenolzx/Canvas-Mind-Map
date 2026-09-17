const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.CMM_PLAYWRIGHT || 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CMM_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
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
   async function drag(source,target,ratio,valid=true) {
    await page.evaluate(()=>{const v=window.writingTest.view;v.collapsed.clear();v.draw();v.fit();});
    await page.waitForTimeout(100);
    const start=await point(source),end=await point(target,ratio),writes=await page.evaluate(()=>window.writingTest.getWrites());
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});
    if(await page.evaluate(()=>window.writingTest.getWrites())!==writes)throw new Error('Drag wrote Markdown before drop');
    const preview=await page.locator('.cmm-writing-drop-preview').textContent();
    if(valid&&preview.includes('不可放置'))throw new Error(preview);
    if(!valid&&!preview.includes('不可放置'))throw new Error('Cycle preview must be invalid');
    await page.mouse.up();
    if(valid) await page.waitForFunction(count=>window.writingTest.getWrites()>count,writes);
    else {await page.waitForTimeout(100);if(await page.evaluate(()=>window.writingTest.getWrites())!==writes)throw new Error('Invalid drop wrote file');}
   }
   await drag('Results','Introduction',.1);
   await drag('Results','Background',.5);
   await drag('Results','Conclusion',.9);
   await drag('Background','Child',.5,false);
   console.log('PASS real pointer Before / Make child / After, no writes during drag, cycle rejection');
  }
  await page.screenshot({path:'tmp/writing-browser/result.png',fullPage:true});
  if(await page.evaluate(()=>!!window.testError))process.exitCode=1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
