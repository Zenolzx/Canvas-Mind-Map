import { Menu } from 'obsidian';
import { t } from '../i18n';
import type { OrganicLayoutStyle } from './OrganicViewState';

export interface OrganicToolbarActions {
    search(query: string): void; next(delta: number): void; clearSearch(): void;
    focus(): void; reading(): void; refresh(): void; fit(): void; zoom(factor: number): void;
    layout(style: OrganicLayoutStyle): void;
    export(format: 'svg' | 'png'): void;
}
export class OrganicToolbar {
    readonly status: HTMLElement;
    private searchRow: HTMLElement;
    private input: HTMLInputElement;
    private count: HTMLElement;
    private focusButton: HTMLButtonElement;
    private readingButton: HTMLButtonElement;
    constructor(container: HTMLElement, private actions: OrganicToolbarActions) {
        const bar = container.createDiv({ cls: 'cmm-organic-toolbar' });
        const button = (label: string, action: () => void) => {
            const b = bar.createEl('button', { text: label }); b.addEventListener('click', action); return b;
        };
        button(t('搜索标题'), () => this.openSearch());
        this.focusButton = button(t('聚焦当前分支'), actions.focus);
        this.readingButton = button(t('阅读此分支'), actions.reading);
        const layout = bar.createEl('select', { attr: { 'aria-label': t('布局') } });
        for (const [value, text] of [['organic-radial', 'Organic Radial'], ['organic-horizontal', 'Organic Horizontal'], ['compact-organic', 'Compact Organic']])
            layout.createEl('option', { text, value });
        layout.addEventListener('change', () => actions.layout(layout.value as OrganicLayoutStyle));
        this.layoutSelect = layout;
        button(t('导出'), () => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle('SVG').onClick(() => actions.export('svg')));
            menu.addItem(item => item.setTitle('PNG').onClick(() => actions.export('png')));
            const rect = bar.getBoundingClientRect(); menu.showAtPosition({ x: rect.right - 120, y: rect.bottom });
        });
        button(t('刷新'), actions.refresh); button(t('适应窗口'), actions.fit);
        button('−', () => actions.zoom(0.8)); button('+', () => actions.zoom(1.25));
        this.status = bar.createSpan({ cls: 'cmm-organic-status', text: t('请选择 Markdown 笔记') });
        this.searchRow = container.createDiv({ cls: 'cmm-organic-search' }); this.searchRow.hidden = true;
        this.input = this.searchRow.createEl('input', { type: 'search', attr: { 'aria-label': t('搜索标题') } });
        this.input.addEventListener('input', () => actions.search(this.input.value));
        this.input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); actions.next(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeSearch(); }
        });
        this.count = this.searchRow.createSpan(); this.count.setAttribute('aria-live', 'polite');
        for (const [text, delta] of [['↑', -1], ['↓', 1]] as const) {
            const b = this.searchRow.createEl('button', { text }); b.setAttribute('aria-label', t(delta < 0 ? '上一项' : '下一项'));
            b.addEventListener('click', () => actions.next(delta));
        }
        this.searchRow.createEl('button', { text: '×', attr: { 'aria-label': t('清除搜索') } }).addEventListener('click', () => this.closeSearch());
    }
    private layoutSelect: HTMLSelectElement;
    get searching(): boolean { return !this.searchRow.hidden; }
    setQuery(query: string): void { this.input.value = query; }
    openSearch(): void { this.searchRow.hidden = false; this.input.focus(); this.input.select(); }
    closeSearch(): void { this.input.value = ''; this.searchRow.hidden = true; this.actions.clearSearch(); }
    update(index: number, total: number, focus: boolean, reading: boolean, layout: OrganicLayoutStyle): void {
        this.layoutSelect.value = layout;
        this.count.textContent = `${index + 1} / ${total}`;
        this.focusButton.textContent = t(focus ? '退出聚焦' : '聚焦当前分支');
        this.readingButton.textContent = t(reading ? '退出阅读模式' : '阅读此分支');
    }
}
