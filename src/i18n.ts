export type LanguageSetting = 'auto' | 'en' | 'zh-CN';

const EN: Record<string, string> = {
    '以 Organic 模式打开笔记': 'Open note in Organic mode',
    '刷新': 'Refresh', '适应窗口': 'Fit to view', '请选择 Markdown 笔记': 'Choose a Markdown note',
    '标题节点': 'heading nodes', '点击标题跳转，拖动空白平移': 'Click headings to open source; drag background to pan',
    '无法读取原笔记，请确认文件仍然存在。': 'Cannot read the source note. Check that the file still exists.',
    '原笔记已修改，请先刷新导图再跳转。': 'The source note has changed. Refresh the mind map before navigating.',
    '自动': 'Automatic', '英语': 'English', '简体中文': 'Simplified Chinese',
    '语言': 'Language', '自动跟随 Obsidian；不支持的语言使用英语。': 'Follow Obsidian automatically; unsupported languages use English.',
    '语言已更新。重新加载插件后，命令面板中的名称也会更新。': 'Language updated. Reload the plugin to update Command Palette names.',
    '生成可折叠思维导图': 'Generate collapsible mind map',
    '思维导图：展开下一级': 'Mind map: Expand next level', '思维导图：收起分支': 'Mind map: Collapse branch',
    '思维导图：显示到第 N 层': 'Mind map: Show to level N', '思维导图：返回中心': 'Mind map: Return to center',
    '思维导图：重新排列整图': 'Mind map: Relayout entire map', '思维导图：切换布局': 'Mind map: Switch layout',
    '思维导图：从原笔记刷新': 'Mind map: Refresh from source note', '思维导图：应用层级模板': 'Mind map: Apply level template',
    '思维导图：设置当前节点外观': 'Mind map: Set node appearance', '思维导图：聚焦当前分支': 'Mind map: Focus branch',
    '思维导图：查看全貌': 'Mind map: Show overview', '思维导图：搜索标题': 'Mind map: Search titles',
    '思维导图：退出分支聚焦': 'Mind map: Exit branch focus', '返回思维导图中心': 'Return to mind map center',
    '聚焦当前分支': 'Focus branch', '退出分支聚焦': 'Exit branch focus', '查看思维导图全貌': 'Show mind map overview',
    '搜索标题（包含折叠节点）…': 'Search titles (including folded nodes)…', '展开下一级标题': 'Expand next heading level',
    '收起整个分支': 'Collapse entire branch', '显示到第 N 层…': 'Show to level N…',
    '重新排列整张思维导图': 'Relayout entire mind map', '切换思维导图布局…': 'Switch mind map layout…',
    '从原笔记刷新思维导图': 'Refresh mind map from source note', '应用层级模板（保留单节点覆盖）': 'Apply level template (keep node overrides)',
    '设置此节点外观…': 'Set node appearance…', '思维导图操作失败，请查看控制台。': 'Mind map action failed. Check the console.',
    '无标题': 'Untitled', '中心': 'Central Topic', '节点内容': 'Node content', '仅标题': 'Title only', '含正文': 'Include body',
    '布局': 'Layout', '选项': 'Options', '取消': 'Cancel', '生成': 'Generate', '切换思维导图布局': 'Switch mind map layout',
    '重新排列整棵导图，保留内容、样式和折叠状态。可撤销。': 'Relayout the entire map while preserving content, styles, and fold state. Undo is available.',
    '应用布局': 'Apply layout', '没有找到可生成思维导图的标题。': 'No headings were found for generating a mind map.',
    '已生成思维导图，共 {count} 个节点，显示到第 2 层。': 'Generated a {count}-node mind map, shown to level 2.',
    '显示到第几层': 'Show to which level', '中心为第 0 层': 'The center is level 0',
    '统一重设整张导图的展开状态。': 'Reset the expansion state of the entire mind map.', '应用': 'Apply',
    '中心节点已不存在。': 'The center node no longer exists.', '聚焦：{title}': 'Focus: {title}',
    '其他分支的显示方式': 'How to display other branches', '临时隐藏其他分支': 'Temporarily hide other branches',
    '淡化其他分支': 'Dim other branches', '紧凑布局': 'Compact layout', '退出聚焦': 'Exit focus', '搜索标题': 'Search titles',
    '搜索标题或章节路径（包含折叠节点）': 'Search titles or section paths (including folded nodes)',
    '该标题已不存在，请重新搜索。': 'That heading no longer exists. Search again.',
    '画布为只读，无法展开折叠路径。': 'The Canvas is read-only, so the folded path cannot be expanded.',
    '聚焦布局失败，已恢复原位置。': 'Focus layout failed; original positions were restored.',
    '已应用层级模板，保留单节点覆盖。': 'Applied the level template while preserving node overrides.',
    '此节点的外观': 'Node appearance', '保存': 'Save', '恢复层级模板': 'Restore level template',
    '中心节点已不存在，无法刷新。': 'The center node no longer exists, so the map cannot be refreshed.',
    '画布或原文已发生变化，请重新执行刷新。': 'The Canvas or source note changed. Run refresh again.',
    '刷新完成：保留 {retained}，新增 {added}，移除 {removed} 个标题节点。': 'Refresh complete: kept {retained}, added {added}, and removed {removed} heading nodes.',
    '确认标题结构变更': 'Confirm heading structure changes',
    '以下旧标题无法可靠匹配（可能已改名、移动、删除或重名）。刷新将移除这些卡片及其连线，包括 {edges} 条额外连接。取消可保留当前导图。': 'The old headings below could not be matched reliably (they may have been renamed, moved, deleted, or duplicated). Refreshing will remove these cards and their connections, including {edges} additional edges. Cancel to keep the current map.',
    '移除 {count} 个旧节点': 'Remove {count} old nodes', '新增 {count} 个节点': 'Add {count} nodes', '确认刷新': 'Confirm refresh',
    '收起分支': 'Collapse branch', '展开下一级': 'Expand next level', '{count} 个隐藏后代': '{count} hidden descendants',
    '宽度': 'Width', '高度（自动高度时作为初始值）': 'Height (initial value with automatic height)',
    '画布单位，范围 50–5000。': 'Canvas units, from 50 to 5000.', '自动高度': 'Automatic height',
    '按内容增高；手动拖动高度后保留你的调整。': 'Grow to fit content; manual height adjustments are preserved.',
    '背景颜色': 'Background color', '留空使用默认颜色，1–6 使用画布颜色，或输入 #RRGGBB。': 'Leave blank for the default, use 1–6 for Canvas colors, or enter #RRGGBB.',
    '思维导图': 'Mind map', '思维导图层级模板': 'Mind map level templates',
    '按距离中心的实际层数设置。修改用于新节点；已有导图可通过右键应用模板。': 'Configure actual levels from the center. Changes apply to new nodes; use the context menu to apply templates to an existing map.',
    '第 0 层 · 中心': 'Level 0 · Center', '第 {depth} 层': 'Level {depth}',
    '聚焦阅读': 'Branch focus', '聚焦时优化子树布局': 'Optimize subtree layout while focused',
    '临时紧凑排列当前可见后代；退出聚焦后恢复原位置。': 'Temporarily arrange visible descendants compactly and restore their original positions on exit.',
    '中心向四周': 'Radial', '左右双侧': 'Horizontal (both sides)', '上下双侧': 'Vertical (both sides)',
    '向右': 'Right', '向左': 'Left', '向下': 'Down', '向上': 'Up',
};

let current: 'en' | 'zh-CN' = 'en';

export function setLanguage(setting: LanguageSetting, obsidianLocale = ''): void {
    const locale = obsidianLocale.toLowerCase().replace('_', '-');
    current = setting === 'zh-CN' || (setting === 'auto' && (locale === 'zh-cn' || locale.startsWith('zh-hans'))) ? 'zh-CN' : 'en';
}

export function t(key: string, values: Record<string, string | number> = {}): string {
    let text = current === 'en' ? EN[key] ?? key : key;
    for (const [name, value] of Object.entries(values)) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    return text;
}

export function languageOptions(): Record<LanguageSetting, string> {
    return { auto: t('自动'), en: t('英语'), 'zh-CN': t('简体中文') };
}
