import { Menu, setIcon } from 'obsidian';
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
        const navigation = bar.createDiv({ cls: 'cmm-organic-toolbar-navigation' });
        const tools = bar.createDiv({ cls: 'cmm-organic-toolbar-tools' });
        // Icon-and-label buttons: a text glyph is not an icon and reads as a placeholder.
        const button = (parent: HTMLElement, label: string, action: () => void, icon?: string) => {
            const b = parent.createEl('button', { attr: { 'aria-label': label, title: label } });
            if (icon) { setIcon(b, icon); b.createSpan({ cls: 'cmm-button-label', text: label }); }
            else b.textContent = label;
            b.addEventListener('click', action); return b;
        };
        const iconButton = (parent: HTMLElement, label: string, action: () => void, icon: string) => {
            const b = parent.createEl('button', { attr: { 'aria-label': label, title: label } });
            setIcon(b, icon); b.addEventListener('click', action); return b;
        };
        button(navigation, t('搜索标题'), () => this.openSearch(), 'search');
        this.focusButton = button(navigation, t('聚焦当前分支'), actions.focus);
        this.readingButton = button(navigation, t('阅读此分支'), actions.reading);
        const layout = navigation.createEl('select', { attr: { 'aria-label': t('布局') } });
        for (const [value, text] of [['organic-radial', t('放射布局')], ['organic-horizontal', t('水平布局')], ['compact-organic', t('紧凑布局')]])
            layout.createEl('option', { text, value });
        layout.addEventListener('change', () => actions.layout(layout.value as OrganicLayoutStyle));
        this.layoutSelect = layout;
        button(tools, t('导出'), () => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle('SVG').onClick(() => actions.export('svg')));
            menu.addItem(item => item.setTitle('PNG').onClick(() => actions.export('png')));
            const rect = tools.getBoundingClientRect(); menu.showAtPosition({ x: rect.right - 120, y: rect.bottom });
        }, 'download');
        button(tools, t('刷新'), actions.refresh, 'refresh-cw'); button(tools, t('适应窗口'), actions.fit, 'maximize');
        iconButton(tools, t('缩小'), () => actions.zoom(0.8), 'zoom-out');
        iconButton(tools, t('放大'), () => actions.zoom(1.25), 'zoom-in');
        this.status = bar.createSpan({ cls: 'cmm-organic-status', text: t('请选择 Markdown 笔记') });
        this.searchRow = container.createDiv({ cls: 'cmm-organic-search' }); this.searchRow.hidden = true;
        this.input = this.searchRow.createEl('input', { type: 'search', attr: { 'aria-label': t('搜索标题') } });
        this.input.addEventListener('input', () => actions.search(this.input.value));
        this.input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); actions.next(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeSearch(); }
        });
        this.count = this.searchRow.createSpan(); this.count.setAttribute('aria-live', 'polite');
        for (const [icon, delta] of [['chevron-up', -1], ['chevron-down', 1]] as const)
            iconButton(this.searchRow, t(delta < 0 ? '上一项' : '下一项'), () => actions.next(delta), icon);
        iconButton(this.searchRow, t('清除搜索'), () => this.closeSearch(), 'x');
    }
    private layoutSelect: HTMLSelectElement;
    get searching(): boolean { return !this.searchRow.hidden; }
    setQuery(query: string): void { this.input.value = query; }
    openSearch(): void { this.searchRow.hidden = false; this.input.focus(); this.input.select(); }
    closeSearch(): void { this.input.value = ''; this.searchRow.hidden = true; this.actions.clearSearch(); }
    update(index: number, total: number, focus: boolean, reading: boolean, layout: OrganicLayoutStyle): void {
        this.layoutSelect.value = layout;
        this.count.textContent = total ? `${index + 1} / ${total}` : this.input.value ? t('没有搜索结果') : '';
        this.focusButton.textContent = t(focus ? '退出聚焦' : '聚焦当前分支');
        this.readingButton.textContent = t(reading ? '退出阅读模式' : '阅读此分支');
    }
}
