import { Setting } from 'obsidian';
import type CanvasMindMapPlugin from '../../main';
import { t } from '../i18n';

export function renderOrganicSettings(container: HTMLElement, plugin: CanvasMindMapPlugin): void {
    new Setting(container).setName('Organic Mind Map').setHeading();
    new Setting(container).setName(t('原笔记变化时自动刷新')).addToggle(toggle =>
        toggle.setValue(plugin.settings.organic.autoRefresh).onChange(async value => {
            plugin.settings.organic.autoRefresh = value; await plugin.saveSettings();
        }));
    new Setting(container).setName(t('记住 Organic 视图状态')).addToggle(toggle =>
        toggle.setValue(plugin.settings.organic.rememberState).onChange(async value => {
            plugin.settings.organic.rememberState = value; await plugin.saveSettings();
        }));
    new Setting(container).setName(t('默认 Organic 布局')).addDropdown(dropdown => dropdown
        .addOptions({ 'organic-radial': 'Organic Radial', 'organic-horizontal': 'Organic Horizontal', 'compact-organic': 'Compact Organic' })
        .setValue(plugin.settings.organic.defaultLayout).onChange(async value => {
            plugin.settings.organic.defaultLayout = value === 'organic-horizontal' || value === 'compact-organic' ? value : 'organic-radial';
            await plugin.saveSettings();
        }));
    new Setting(container).setName(t('重置已保存的 Organic 视图状态')).addButton(button =>
        button.setButtonText(t('重置')).onClick(async () => { await plugin.organicStates.reset(); }));
    new Setting(container).setName(t('动画')).addToggle(toggle => toggle.setValue(plugin.settings.organic.animation)
        .onChange(async value => { plugin.settings.organic.animation = value; await plugin.saveSettings(); }));
    new Setting(container).setName(t('动画时长')).addSlider(slider => slider.setLimits(0, 500, 25)
        .setValue(plugin.settings.organic.animationDuration).setDynamicTooltip().onChange(async value => {
            plugin.settings.organic.animationDuration = value; await plugin.saveSettings();
        }));
    new Setting(container).setName(t('PNG 导出倍率')).addDropdown(dropdown => dropdown.addOptions({ '1': '1x', '2': '2x', '3': '3x' })
        .setValue(String(plugin.settings.organic.pngScale)).onChange(async value => {
            plugin.settings.organic.pngScale = Number(value); await plugin.saveSettings();
        }));
}
