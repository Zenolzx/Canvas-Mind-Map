'use strict';
/**
 * Minimal SVG DOM used by the renderer unit tests.
 *
 * Not a general-purpose DOM: it supports only the node/attribute/class/query behaviour the
 * renderer exercises, which is enough to assert serialized output deterministically in Node
 * without a browser. The browser suites cover real layout and painting.
 */
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadModule(entry, globals = {}) {
    const output = esbuild.buildSync({ entryPoints: [entry], bundle: true,
        platform: 'node', format: 'cjs', external: ['obsidian'], write: false });
    const sandbox = { module: { exports: {} }, exports: {}, console, require: name => require(name), ...globals };
    vm.runInNewContext(output.outputFiles[0].text, sandbox);
    return sandbox.module.exports;
}

function makeDocument() {
    const document = {};
    const make = name => {
        const attributes = new Map();
        // `class` is tracked as a set of tokens so `setAttribute('class', …)` and
        // `classList.add(…)` cannot disagree, which is how the DOM behaves.
        const classes = new Set();
        const node = {
            nodeName: name, children: [], parentNode: undefined, ownerDocument: document,
            style: { setProperty() {}, removeProperty() {} },
            get attributes() { return [...attributes].map(([n, v]) => ({ name: n, value: v })); },
            setAttribute(n, v) {
                if (n === 'class') { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); return; }
                attributes.set(n, String(v));
            },
            getAttribute(n) { return n === 'class' ? [...classes].join(' ') : attributes.has(n) ? attributes.get(n) : null; },
            removeAttribute(n) { if (n === 'class') classes.clear(); else attributes.delete(n); },
            hasAttribute(n) { return n === 'class' ? classes.size > 0 : attributes.has(n); },
            append(...kids) { for (const kid of kids) { kid.parentNode = node; node.children.push(kid); } },
            prepend(...kids) { for (const kid of kids.reverse()) { kid.parentNode = node; node.children.unshift(kid); } },
            insertBefore(kid) { kid.parentNode = node; node.children.unshift(kid); },
            replaceChildren(...kids) { node.children = []; node.append(...kids); },
            remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(c => c !== node); },
            addEventListener() {}, setCssStyles() {}, focus() {},
            get textContent() { return node.children.map(c => c.textContent ?? '').join(''); },
            set textContent(value) { node.children = [{ textContent: String(value), children: [], parentNode: node }]; },
            _attrs: attributes, _classes: classes,
            querySelectorAll(selector) { return descendants(node).filter(el => matches(el, selector)); },
            querySelector(selector) { return node.querySelectorAll(selector)[0] ?? null; },
        };
        node.classList = {
            add: (...names) => names.forEach(n => classes.add(n)),
            remove: (...names) => names.forEach(n => classes.delete(n)),
            contains: name => classes.has(name),
            toggle: (name, force) => { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
        };
        return node;
    };
    const descendants = node => node.children.flatMap(child => child.children ? [child, ...descendants(child)] : []);
    const matchesCompound = (el, selector) => {
        if (selector.startsWith('.')) return el._classes?.has(selector.slice(1));
        if (selector.startsWith('[') && selector.endsWith(']')) return el._attrs?.has(selector.slice(1, -1));
        return el.nodeName === selector;
    };
    const ancestors = el => { const chain = []; let current = el.parentNode; while (current) { chain.push(current); current = current.parentNode; } return chain; };
    /** Supports the descendant combinator (`a b`) as well as a simple selector. */
    const matches = (el, selector) => {
        const parts = selector.trim().split(/\s+/);
        if (!matchesCompound(el, parts[parts.length - 1])) return false;
        let chain = ancestors(el);
        for (let i = parts.length - 2; i >= 0; i--) {
            const index = chain.findIndex(candidate => matchesCompound(candidate, parts[i]));
            if (index < 0) return false;
            chain = chain.slice(index + 1);
        }
        return true;
    };
    document.createElementNS = (_ns, name) => make(name);
    document.defaultView = undefined;
    return document;
}

/** Serialize a node tree the way XMLSerializer would, for assertion on output. */
function serialize(node) {
    const walk = current => {
        if (!current.nodeName) return current.textContent ?? '';
        const attrs = (current.attributes ?? []).map(({ name, value }) => ` ${name}="${value}"`).join('');
        const classes = current._classes?.size ? ` class="${[...current._classes].join(' ')}"` : '';
        const inner = (current.children ?? []).map(walk).join('');
        return `<${current.nodeName}${classes}${attrs}>${inner}</${current.nodeName}>`;
    };
    return walk(node);
}

module.exports = { loadModule, makeDocument, serialize };
