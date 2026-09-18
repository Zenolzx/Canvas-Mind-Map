// Generates a real-browser regression page. It exercises production renderer/export code.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const destination = path.resolve('tmp/organic-browser'); fs.mkdirSync(destination, { recursive: true });
const source = `
import { buildMindMapModel } from './src/core/MindMapModel';
import { OrganicLayoutEngine } from './src/organic/OrganicLayoutEngine';
import { OrganicMindMapRenderer, svgElement } from './src/organic/OrganicMindMapRenderer';
import { OrganicExportService } from './src/organic/OrganicExportService';
import { OrganicMindMapView } from './src/organic/OrganicMindMapView';
import { OrganicStateStore } from './src/organic/OrganicStateStore';
import { TFile } from 'obsidian';
const report = document.getElementById('report');
const log = text => { const line = document.createElement('p'); line.textContent = text; report.append(line); };
const assert = (value, message) => { if (!value) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
const engine = new OrganicLayoutEngine(), renderer = new OrganicMindMapRenderer(), exporter = new OrganicExportService();
const context = document.createElement('canvas').getContext('2d');
const measureText = (text, size, weight) => { context.font = weight + ' ' + size + 'px Arial'; return context.measureText(text).width; };
const svg = document.getElementById('map'), scene = document.getElementById('scene');
const presentation = { background: '#fffaf4', rootBackground: '#f7efe4', foreground: '#45423f', border: '#c6b9a6', accent: '#218b89', highlight: '#ffe39c', fontFamily: 'Arial' };
for (const count of [50, 200, 500]) {
 const markdown = Array.from({length: count}, (_, i) => '#'.repeat(i === 0 ? 1 : i % 20 === 1 ? 2 : i % 4 === 2 ? 3 : 4) + ' 中文标题 😀 Section ' + i).join('\\n');
 const model = buildMindMapModel(markdown, {title: 'test'});
 const start = performance.now(); const result = engine.layout(model, {collapsed: new Set(), measureText, style: 'compact-organic'});
 let toggles = 0; const actions = {navigate: () => {}, toggle: () => {toggles++;}, toggleLabel: () => 'Toggle'};
 renderer.render(scene, result, actions); const elapsed = performance.now() - start;
 const b = result.bounds; svg.setAttribute('viewBox', [b.x,b.y,b.width,b.height].join(' '));
 assert(scene.querySelectorAll('[data-node-id]').length === count, 'render node count');
 scene.querySelector('[role="button"]').dispatchEvent(new MouseEvent('click', {bubbles:true})); assert(toggles === 1, 'delegated toggle');
 const text = exporter.svg(document, result, presentation);
 const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
 assert(!parsed.querySelector('parsererror'), 'SVG XML parsing');
 assert(parsed.querySelectorAll('[data-node-id]').length === count, 'export node count');
 assert(text.includes('中文标题'), 'Chinese text'); assert(!text.includes('var(--'), 'standalone SVG styles');
 const png = await exporter.png(document, text, result, 2);
 const image = new Image(); const url = URL.createObjectURL(png); image.src = url; await image.decode();
 assert(image.naturalWidth === Math.ceil(b.width * 2) && image.naturalHeight === Math.ceil(b.height * 2), 'PNG dimensions');
 URL.revokeObjectURL(url);
 log('PASS ' + count + ' headings: layout/render ' + elapsed.toFixed(1) + ' ms; SVG valid; PNG ' + image.naturalWidth + '×' + image.naturalHeight + ' (' + png.size + ' bytes)');
 const collapsed = engine.layout(model, {collapsed: new Set([model.rootId]), measureText});
 for (let i=0;i<10;i++) renderer.render(scene, i%2 ? result : collapsed, {...actions, duration:200});
 await pause(300); assert(scene.querySelectorAll('[data-node-id]').length === count, 'animation ghost nodes');
 assert(scene.querySelectorAll('[aria-hidden="true"]').length === 0, 'exit cleanup');
 log('PASS rapid animation cancellation: ' + count + ' headings');
 const originalMatchMedia = window.matchMedia;
 try {
  window.matchMedia = () => ({matches:true});
  renderer.render(scene, collapsed, {...actions,duration:200});
  assert(scene.querySelectorAll('[data-node-id]').length===1 && !scene.querySelector('[aria-hidden="true"]'),'reduced motion must render immediately');
 } finally {window.matchMedia=originalMatchMedia;}
}
for (const text of ['', 'No headings', '# 单节点 😀', '# A\\n# B', '# A\\n### Skip', '# A\\n## Duplicate\\n## Duplicate']) {
 const model = buildMindMapModel(text, {title: 'Empty'}); const result = engine.layout(model, {collapsed:new Set(), measureText});
 const serialized = exporter.svg(document, result, presentation); assert(!new DOMParser().parseFromString(serialized,'image/svg+xml').querySelector('parsererror'), 'edge case SVG');
 await exporter.png(document, serialized, result, 2);
}
renderer.close();
// Real DOM and production View, with only vault/workspace APIs replaced at the host boundary.
for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
    prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
}
HTMLElement.prototype.empty = function(){this.replaceChildren();};
HTMLElement.prototype.addClass = function(name){this.classList.add(name);};
HTMLElement.prototype.createEl = function(tag, options = {}) {
 const el = document.createElement(tag); if(options.text)el.textContent=options.text;if(options.cls)el.className=options.cls;
 for(const key of ['type','value']) if(options[key])el.setAttribute(key,options[key]);
 for(const [key,value] of Object.entries(options.attr || {}))el.setAttribute(key,value);
 this.append(el);return el;
};
HTMLElement.prototype.createDiv = function(options){return this.createEl('div',options);};
HTMLElement.prototype.createSpan = function(options){return this.createEl('span',options);};
let source = '# Root\\n## A\\nUnique section body\\n### Nested\\n#### streamAssistantResponse\\n## B\\n### B child';
let reads = 0, saved; const events = new Map(); const file = new TFile('note.md');
const app = {scope:{},vault:{read:async()=>{reads++;return source;},getAbstractFileByPath:path=>path===file.path?file:null,
 on:(event,listener)=>{events.set(event,[...(events.get(event)||[]),listener]);return listener;}},workspace:{requestSaveLayout(){},getLeavesOfType:()=>[]}};
const store = new OrganicStateStore({},async()=>{saved=JSON.parse(JSON.stringify(store.data));},()=>true);
const view = new OrganicMindMapView({app},store);await view.onOpen();await view.loadSource(file);
const id = title=>view.model.nodes.find(n=>n.title===title).id;
const a=id('A'), b=id('B'), nested=id('Nested');
const toggle = Array.from(view.scene.querySelectorAll('[data-node-id]')).find(el=>el.getAttribute('data-node-id')===nested).querySelector('[role="button"]');
const screenBefore = toggle.getBoundingClientRect(); toggle.dispatchEvent(new MouseEvent('click',{bubbles:true}));
const afterToggle = Array.from(view.scene.querySelectorAll('[data-node-id]')).find(el=>el.getAttribute('data-node-id')===nested).querySelector('[role="button"]').getBoundingClientRect();
assert(Math.abs(screenBefore.x-afterToggle.x)<1 && Math.abs(screenBefore.y-afterToggle.y)<1,'animation must retain fold screen anchor: '+[screenBefore.x,screenBefore.y,afterToggle.x,afterToggle.y].join(','));
await pause(250);
view.focusBranch(b); view.openSearch(); const input=view.contentEl.querySelector('input');
input.value='streamAssistantResponse';input.dispatchEvent(new Event('input',{bubbles:true}));
assert(view.interaction.focusPaused,'search must suspend focus'); assert(view.result.nodes.some(n=>n.title==='streamAssistantResponse'),'search must reveal collapsed result');
await pause(250); // Let search-row resize and smooth navigation settle before the refresh baseline.
const scale=view.scale,offset={...view.offset};const readStart=reads;
source=source.replace('## A','## Renamed')+'\\n## New Section';
for(let i=0;i<10;i++)for(const listener of events.get('modify'))listener(file);
await pause(750);assert(reads===readStart+1,'vault changes must debounce');
assert(view.model.nodes.some(n=>n.title==='New Section'),'new heading missing');assert(id('Renamed')===a,'rename identity');
assert(view.scale===scale && view.offset.x===offset.x && view.offset.y===offset.y,'refresh viewport reset');
assert(view.interaction.search.query==='streamAssistantResponse','refresh lost query');assert(view.state.focusNode===b,'refresh lost focus');
input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!view.interaction.focusPaused && view.state.focusNode===b,'clear search must restore focus');
view.focusBranch(null);view.readBranch(a);view.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
assert(view.state.reading.currentNode===nested,'reading arrow order');
view.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert(view.model.nodes.find(n=>n.id===view.state.reading.currentNode).title==='streamAssistantResponse','reading hidden heading');
view.focusBranch(b);view.state.layout='compact-organic';view.draw();view.zoom(1.1);const zoom=view.scale;await view.onClose();
assert(saved.files['note.md'].focusNode===b,'focus persistence');
const reopened=new OrganicMindMapView({app},store);await reopened.onOpen();await reopened.setState({file:'note.md'},{history:false});
assert(reopened.state.focusNode===b && reopened.scale===zoom && reopened.state.layout==='compact-organic','tab restore');
file.path='folder/moved.md';store.rename('note.md',file.path);reopened.sourceRenamed('note.md',file.path);await pause(20);
assert(reopened.getState().file===file.path && store.get(file.path),'file move');
source='# Entire replacement\\n## New document';await reopened.loadSource(file,false);assert(reopened.state.focusNode===null,'deleted focus');
reopened.sourceDeleted(file.path);store.remove(file.path);assert(!reopened.file,'deleted source');await reopened.onClose();
log('PASS full View: debounced file events, rename identity, search/focus/reading, viewport retention, persistence, workspace restore, move and delete');
log('ALL BROWSER CHECKS PASSED'); document.title = 'PASS — Organic browser regression';
}
run().catch(error => {log('FAIL: ' + error.stack); document.title = 'FAIL — Organic browser regression';});
`;
const result = esbuild.buildSync({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' },
    alias: { obsidian: path.resolve('scripts/organic-browser-obsidian.cjs') }, bundle: true, format: 'iife', write: false });
fs.writeFileSync(path.join(destination, 'test.js'), result.outputFiles[0].text);
fs.writeFileSync(path.join(destination, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Organic browser regression</title><style>${fs.readFileSync('styles.css','utf8')} body {font-family:Arial;background:#fffaf4;color:#45423f} #map {width:100%;height:600px} #report {font:14px monospace}</style></head><body><h1>Organic browser regression</h1><div id="report"></div><svg id="map"><g id="scene"></g></svg><script src="test.js"></script></body></html>`);
console.log(destination);
