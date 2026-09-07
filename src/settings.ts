export interface MindmapLevelStyle {
    width: number;
    height: number;
    autoHeight: boolean;
    color: string;
}

export const DEFAULT_MINDMAP_LEVELS: MindmapLevelStyle[] = Array.from({ length: 7 }, (_, depth) => ({
    width: depth === 0 ? 360 : depth === 1 ? 300 : 250,
    height: 60,
    autoHeight: true,
    color: depth === 0 ? '' : String((depth - 1) % 6 + 1),
}));

export type MindmapLayout = 'radial' | 'horizontal' | 'vertical' | 'right' | 'left' | 'down' | 'up';
export const LAYOUT_LABELS: Record<MindmapLayout, string> = {
    radial: '中心向四周', horizontal: '左右双侧', vertical: '上下双侧',
    right: '向右', left: '向左', down: '向下', up: '向上',
};
export interface MindmapSettings {
    mindmapLevels: MindmapLevelStyle[];
    lastMode: 'title' | 'body';
    lastLayout: MindmapLayout;
}
