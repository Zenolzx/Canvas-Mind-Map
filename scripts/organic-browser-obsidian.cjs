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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('svg-icon', 'lucide-' + icon);
    svg.setAttribute('data-icon', icon);
    element.append(svg);
};

// Test boundary only: production always calls Obsidian's MarkdownRenderer.
exports.Component = class { load() {} unload() {} };
exports.MarkdownRenderer = { render: async (app, markdown, element) => {
    element.innerHTML = require('markdown-it')().render(markdown);
} };
