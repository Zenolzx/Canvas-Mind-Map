// Browser-only Obsidian boundary, used by verify-organic-browser.cjs.
exports.ItemView = class {
    constructor(leaf) { this.app = leaf.app; this.contentEl = document.createElement('div'); this.contentEl.style.height = '600px'; document.body.append(this.contentEl); }
    registerEvent() {}
    async setState() {}
};
exports.Scope = class { register() {} };
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
