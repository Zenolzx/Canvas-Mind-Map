import { Setting } from 'obsidian';
import type CanvasMindMapPlugin from '../../main';
import { t } from '../i18n';
import { normalizeAppearancePreset, normalizeBranchColourMode, normalizeMindmapTypeface, normalizeSurfaceMaterial } from '../settings';

export function renderOrganicSettings(container: HTMLElement, plugin: CanvasMindMapPlugin): void {
    new Setting(container).setName(t('导图外观')).setHeading();
    new Setting(container).setName(t('风格预设')).setDesc(t('应用于 Composer、Organic 和 Canvas 导图。'))
        .addDropdown(dropdown => dropdown
            .addOptions({
                obsidian: t('跟随 Obsidian 主题'),
                ink: t('淡雅青绿·水墨'), cinnabar: t('暖白宣纸·朱砂'),
                breeze: t('薄荷叶影'), violet: t('樱花湖景'),
            })
            .setValue(plugin.settings.appearance).onChange(async value => {
                plugin.settings.appearance = normalizeAppearancePreset(value);
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName(t('底纹')).setDesc(t('绘制在导图下方的结构，与配色相互独立。'))
        .addDropdown(dropdown => dropdown
            .addOptions({ none: t('纯色'), dots: t('点阵'), grid: t('方格'), paper: t('纸纹') })
            .setValue(plugin.settings.surfaceMaterial).onChange(async value => {
                plugin.settings.surfaceMaterial = normalizeSurfaceMaterial(value);
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName(t('分支配色')).setDesc(t('为每个顶层分支分配稳定且互不相同的颜色。'))
        .addDropdown(dropdown => dropdown
            .addOptions({ palette: t('按分支自动配色'), monochrome: t('沿用预设单色') })
            .setValue(plugin.settings.branchColour).onChange(async value => {
                plugin.settings.branchColour = normalizeBranchColourMode(value);
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName(t('标题字体')).setDesc(t('卡片与标题的字体；默认跟随仓库设置。'))
        .addDropdown(dropdown => dropdown
            .addOptions({ match: t('跟随 Obsidian'), serif: t('衬线') })
            .setValue(plugin.settings.typography).onChange(async value => {
                plugin.settings.typography = normalizeMindmapTypeface(value);
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName(t('背景图片')).setDesc(t('仓库内的相对路径；留空则使用底纹。图片会取代底纹，不会叠加。'))
        .addText(text => text.setPlaceholder('attachments/paper.jpg')
            .setValue(plugin.settings.backgroundImage).onChange(async value => {
                plugin.settings.backgroundImage = value;
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName(t('背景强度')).setDesc(t('在背景图上叠加纸张色以恢复对比度。'))
        .addSlider(slider => slider.setLimits(0, 100, 5).setValue(plugin.settings.backgroundImageStrength)
            .onChange(async value => {
                plugin.settings.backgroundImageStrength = value;
                plugin.refreshAppearance(); await plugin.saveSettings();
            }));
    new Setting(container).setName('Organic mind map').setHeading();
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
        .setValue(plugin.settings.organic.animationDuration).onChange(async value => {
            plugin.settings.organic.animationDuration = value; await plugin.saveSettings();
        }));
    new Setting(container).setName(t('PNG 导出倍率')).addDropdown(dropdown => dropdown.addOptions({ '1': '1x', '2': '2x', '3': '3x' })
        .setValue(String(plugin.settings.organic.pngScale)).onChange(async value => {
            plugin.settings.organic.pngScale = Number(value); await plugin.saveSettings();
        }));
}
