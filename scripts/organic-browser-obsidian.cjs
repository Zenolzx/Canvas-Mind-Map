// Browser-only Obsidian boundary, used by verify-organic-browser.cjs.
exports.ItemView = class {
    constructor(leaf) { this.app = leaf.app; this.contentEl = document.createElement('div'); this.contentEl.style.height = '600px'; document.body.append(this.contentEl); }
    registerEvent() {}
    async setState() {}
};
exports.Scope = class { register() {} };
// Test boundary only: Obsidian detects the host here. Suites run the desktop path by default;
// a fixture can set `window.CMM_TEST_MOBILE = true` before load to exercise the touch branches.
// `process` is deliberately not read: this stub also runs inside the browser bundle.
const testMobile = () => typeof window !== 'undefined' && window.CMM_TEST_MOBILE === true;
exports.Platform = {
    get isMobile() { return testMobile(); },
    get isDesktop() { return !testMobile(); },
    get isPhone() { return false; },
    get isTablet() { return testMobile(); },
};
exports.Notice = class { constructor(text) { console.log('Notice:', text); } };
exports.TFile = class { constructor(path) { this.path = path; this.extension = 'md'; } get basename() { return this.path.split('/').pop().slice(0,-3); } };
exports.Menu = class { addItem(build) { const item = {setTitle(){return this;},onClick(){return this;}};build(item);return this;} showAtMouseEvent(){} showAtPosition(){} };
exports.Modal = class {
    constructor(app) { this.app = app; this.containerEl = document.createElement('div'); this.containerEl.className = 'test-modal';
        this.titleEl = document.createElement('h2'); this.contentEl = document.createElement('div'); this.containerEl.append(this.titleEl, this.contentEl); }
    open() { document.body.append(this.containerEl); this.onOpen?.(); }
    close() { this.containerEl.remove(); this.onClose?.(); }
};
exports.MarkdownView = class {};
exports.editorInfoField = require('@codemirror/state').StateField.define({create: () => ({}), update: value => value});

// Test boundary only: production calls Obsidian's Lucide icon renderer. Emitting a real
// element keeps icon-bearing buttons structurally identical to the shipped UI.
exports.setIcon = function (element, icon) {
    element.replaceChildren(); element.setAttribute('data-icon', icon);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('svg-icon', 'lucide-' + icon);
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    const paths = {
      search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
      plus:'M12 5v14M5 12h14', minus:'M5 12h14', x:'M6 6l12 12M6 18L18 6',
      'corner-down-right':'M5 4v9a3 3 0 0 0 3 3h12m-5-5 5 5-5 5',
      'panel-right':'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M15 3v18',
      scan:'M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4',
      workflow:'M3 3h7v7H3zM14 14h7v7h-7zM6.5 10v7.5H14M10 6.5h7.5V14',
      palette:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.8 1.8 0 0 1 1-3.3h2a4 4 0 0 0 4-4c0-4-4-7-9-7M7 10h.01M10 7h.01M15 7h.01M18 10h.01',
      'sliders-horizontal':'M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10M7 3v6m6 0v6m-6 0v6',
      ellipsis:'M5 12h.01M12 12h.01M19 12h.01',
      download:'M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5',
      'refresh-cw':'M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
      maximize:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
      'zoom-out':'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0M6 10h8',
      'zoom-in':'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0M6 10h8M10 6v8',
    };
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[icon]||paths.ellipsis);svg.append(path);element.append(svg);
};

// Test boundary only: production always calls Obsidian's MarkdownRenderer.
exports.Component = class { load() {} unload() {} };
exports.MarkdownRenderer = { render: async (app, markdown, element) => {
    element.innerHTML = require('markdown-it')().render(markdown);
} };
