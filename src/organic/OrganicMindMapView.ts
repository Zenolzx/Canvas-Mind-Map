import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { buildMindMapModel, MindMapModel } from '../core/MindMapModel';
import { t } from '../i18n';
import { OrganicLayoutEngine, OrganicLayoutResult } from './OrganicLayoutEngine';
import { OrganicMindMapRenderer, svgElement } from './OrganicMindMapRenderer';

export const ORGANIC_VIEW = 'canvas-mind-map-organic';

/** Session-only reading controller: source, folding and viewport never enter Canvas data. */
export class OrganicMindMapView extends ItemView {
    private file?: TFile;
    private sourceText = '';
    private sourceLeaf?: WorkspaceLeaf;
    private model?: MindMapModel;
    private result?: OrganicLayoutResult;
    private collapsed = new Set<string>();
    private svg!: SVGSVGElement;
    private scene!: SVGGElement;
    private status!: HTMLElement;
    private scale = 1;
    private offset = { x: 0, y: 0 };
    private revision = 0;
    private closed = false;
    private measure!: (text: string, size: number, weight: number) => number;
    private renderer = new OrganicMindMapRenderer();
    private engine = new OrganicLayoutEngine();
    constructor(leaf: WorkspaceLeaf) { super(leaf); }
    getViewType(): string { return ORGANIC_VIEW; }
    getDisplayText(): string { return this.file ? `${this.file.basename} · Organic` : 'Organic Mind Map'; }
    getIcon(): string { return 'git-fork'; }

    async onOpen(): Promise<void> {
        this.closed = false;
        this.contentEl.empty(); this.contentEl.addClass('cmm-organic-view');
        const toolbar = this.contentEl.createDiv({ cls: 'cmm-organic-toolbar' });
        const button = (label: string, action: () => void) => {
            const element = toolbar.createEl('button', { text: label });
            element.addEventListener('click', action);
        };
        button(t('刷新'), () => { if (this.file) void this.loadSource(this.file, false); });
        button(t('适应窗口'), () => this.fit());
        button('−', () => this.zoom(0.8)); button('+', () => this.zoom(1.25));
        this.status = toolbar.createSpan({ cls: 'cmm-organic-status', text: t('请选择 Markdown 笔记') });
        const document = this.contentEl.ownerDocument;
        this.svg = svgElement(document, 'svg', { class: 'cmm-organic-surface', role: 'group',
            'aria-label': 'Organic Mind Map', tabindex: 0 });
        this.scene = svgElement(document, 'g'); this.svg.append(this.scene); this.contentEl.append(this.svg);
        const context = document.createElement('canvas').getContext('2d')!;
        const family = document.defaultView!.getComputedStyle(this.contentEl).fontFamily;
        this.measure = (text, size, weight) => {
            context.font = `${weight} ${size}px ${family}`; return context.measureText(text).width;
        };
        this.svg.style.fontFamily = family;
        let drag: { id: number; x: number; y: number } | undefined;
        this.svg.addEventListener('pointerdown', event => {
            if (event.button !== 0 || (event.target as Element).closest('[role="link"], [role="button"]')) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            this.svg.setPointerCapture(event.pointerId);
        });
        this.svg.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            this.offset.x += event.clientX - drag.x; this.offset.y += event.clientY - drag.y;
            drag.x = event.clientX; drag.y = event.clientY; this.transform();
        });
        const stop = () => { drag = undefined; };
        this.svg.addEventListener('pointerup', stop); this.svg.addEventListener('pointercancel', stop);
        this.svg.addEventListener('lostpointercapture', stop);
        this.svg.addEventListener('wheel', event => {
            event.preventDefault(); const rect = this.svg.getBoundingClientRect();
            this.zoom(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });
        this.svg.addEventListener('keydown', event => {
            if (event.target !== this.svg) return;
            if (event.key === '+' || event.key === '=') this.zoom(1.25);
            else if (event.key === '-') this.zoom(0.8);
            else if (event.key === '0') this.fit();
            else if (event.key.startsWith('Arrow')) {
                this.offset.x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
                this.offset.y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
                this.transform();
            } else return;
            event.preventDefault();
        });
    }

    async loadSource(file: TFile, reset = true): Promise<void> {
        const revision = ++this.revision;
        try {
            const markdown = await this.app.vault.read(file);
            if (this.closed || revision !== this.revision) return;
            const model = buildMindMapModel(markdown, { title: file.basename, file: file.path });
            this.file = file; this.model = model; this.sourceText = markdown;
            if (reset) this.collapsed = new Set(model.nodes.filter(n => n.depth >= 2).map(n => n.id));
            else this.collapsed = new Set([...this.collapsed].filter(id => model.nodes.some(n => n.id === id)));
            this.draw(); if (reset) this.fit();
            this.status.textContent = `${file.basename} · ${model.nodes.length} ${t('标题节点')} · ${t('点击标题跳转，拖动空白平移')}`;
        } catch (error) {
            if (revision !== this.revision || this.closed) return;
            new Notice(t('无法读取原笔记，请确认文件仍然存在。'));
            console.error('Organic mind map: source load failed', error);
        }
    }

    private draw(anchorId?: string): void {
        if (!this.model) return;
        const old = this.result?.nodes.find(node => node.id === anchorId);
        const result = this.engine.layout(this.model, { collapsed: this.collapsed, measureText: this.measure });
        const next = result.nodes.find(node => node.id === anchorId);
        if (old && next) {
            this.offset.x += (old.x - next.x) * this.scale;
            this.offset.y += (old.y - next.y) * this.scale;
        }
        this.result = result;
        this.renderer.render(this.scene, result, {
            navigate: id => { void this.navigate(id); },
            toggle: id => {
                if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
                this.draw(id);
                // Restore keyboard focus after replacing the rendered tree.
                const group = Array.from(this.scene.querySelectorAll<SVGGElement>('[data-node-id]'))
                    .find(element => element.getAttribute('data-node-id') === id);
                group?.querySelector<SVGGElement>('[role="button"]')?.focus();
            },
            toggleLabel: collapsed => t(collapsed ? '展开下一级' : '收起分支'),
        });
        this.transform();
    }

    private async navigate(id: string): Promise<void> {
        const node = this.model?.nodes.find(n => n.id === id), file = this.file;
        if (!node || !file) return;
        const revision = this.revision, snapshot = this.sourceText;
        try {
            const current = await this.app.vault.read(file);
            if (this.closed || revision !== this.revision) return;
            if (current !== snapshot) {
                new Notice(t('原笔记已修改，请先刷新导图再跳转。')); return;
            }
            const leaf = this.sourceLeaf && this.app.workspace.getLeavesOfType('markdown').includes(this.sourceLeaf)
                ? this.sourceLeaf : this.app.workspace.getLeaf('split');
            this.sourceLeaf = leaf;
            await leaf.openFile(file, { active: true, eState: { line: node.source.line } });
        } catch (error) { new Notice(t('无法读取原笔记，请确认文件仍然存在。')); }
    }
    private transform(): void { this.scene.setAttribute('transform', `translate(${this.offset.x} ${this.offset.y}) scale(${this.scale})`); }
    private zoom(factor: number, x = this.svg.clientWidth / 2, y = this.svg.clientHeight / 2): void {
        const next = Math.max(0.05, Math.min(4, this.scale * factor)), ratio = next / this.scale;
        this.offset = { x: x - (x - this.offset.x) * ratio, y: y - (y - this.offset.y) * ratio };
        this.scale = next; this.transform();
    }
    private fit(): void {
        if (!this.result) return;
        const { bounds } = this.result;
        const width = this.svg.clientWidth || 800, height = this.svg.clientHeight || 600;
        this.scale = Math.min(1.25, width / bounds.width, height / bounds.height);
        this.offset = { x: width / 2 - (bounds.x + bounds.width / 2) * this.scale,
            y: height / 2 - (bounds.y + bounds.height / 2) * this.scale };
        this.transform();
    }
    async onClose(): Promise<void> { this.closed = true; this.revision++; this.contentEl.empty(); }
}

