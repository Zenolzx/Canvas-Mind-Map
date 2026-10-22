const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('./lib/browser.cjs').requireTooling('README screenshots');
const {launchOptions}=require('./lib/browser.cjs');
(async()=>{
 const browser=await chromium.launch(launchOptions());
 try{
  fs.mkdirSync('docs/images',{recursive:true});
  for(const lang of ['en','zh-CN']){
   const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
   await page.goto(pathToFileURL(path.resolve('tmp/composer-browser/index.html')).href+'?lang='+lang);
   await page.waitForFunction(()=>window.ready);
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.evaluate(zh=>{
    const v=window.composerTest.view;
    const make=(title,children=[])=>({id:crypto.randomUUID(),title,type:'heading',body:'',children});
    const labels=zh?['从想法到一篇好文章','发现问题','收集观察与资料','找到值得回答的问题','组织结构','明确核心观点','安排章节与顺序','展开写作','写好每个章节','补充事实与例子','打磨与分享','删去重复表达','检查并发布']:['From an idea to a finished article','Discover','Collect notes and observations','Find a question worth answering','Outline','Choose the central argument','Arrange sections and flow','Write','Develop each section','Add evidence and examples','Refine and share','Remove repetition','Review and publish'];
    v.draft.root.title=labels[0];
    v.draft.root.children=[1,4,7,10].map(i=>make(labels[i],[make(labels[i+1]),make(labels[i+2])]));
    v.draft.root.children[1].body=zh?'先确定你希望读者带走什么，再安排每一个章节。\n\n让脑图呈现文章结构，在右侧逐段完成正文。\n\n- 一个明确的核心观点\n- 四个相互衔接的章节\n- 支撑观点的事实与例子':'Start with the idea you want readers to take away, then give each section a clear purpose.\n\nKeep the structure in view while developing the selected section.\n\n- One clear central argument\n- Four connected sections\n- Evidence and examples';
    v.draft.unsorted=[make(zh?'读者最想知道什么？':'What will readers want to know?'),make(zh?'补充一个真实案例':'Add a real-world example')];
    v.draft.selection=v.draft.root.children[1].id;
    v.interacted=true;v.render();window.composerTest.applyPreset('ink','paper');v.fit();
   },lang==='zh-CN');
   await page.mouse.move(1590,890);await page.waitForTimeout(900);
   await page.screenshot({path:`docs/images/overview-${lang}.png`,animations:'disabled'});
   await page.evaluate(()=>{const v=window.composerTest.view;window.composerTest.applyPreset('slate','paper');v.openBody();v.fit();});
   await page.waitForTimeout(900);
   await page.screenshot({path:`docs/images/writing-${lang}.png`,animations:'disabled'});
   await page.close();
  }
  console.log('Captured 4 bilingual README screenshots from current Composer components.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
