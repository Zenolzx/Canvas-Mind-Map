import { t, type LanguageSetting } from './i18n';

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
export const LAYOUT_LABEL_KEYS: Record<MindmapLayout, string> = {
    radial: '中心向四周', horizontal: '左右双侧', vertical: '上下双侧',
    right: '向右', left: '向左', down: '向下', up: '向上',
};
export function layoutLabels(): Record<MindmapLayout, string> {
    return Object.fromEntries(Object.entries(LAYOUT_LABEL_KEYS).map(([layout, label]) => [layout, t(label)])) as Record<MindmapLayout, string>;
}
export interface MindmapSettings {
    organic: OrganicSettings;
    appearance: AppearancePreset;
    branchColour: BranchColourMode;
    surfaceMaterial: SurfaceMaterial;
    typography: MindmapTypeface;
    backgroundImage: string;
    backgroundImageStrength: number;
    mindmapLevels: MindmapLevelStyle[];
    lastMode: 'title' | 'body';
    lastLayout: MindmapLayout;
    focusMode: 'hide' | 'dim';
    compactFocus: boolean;
    language: LanguageSetting;
}
export type AppearancePreset = 'obsidian' | 'ink' | 'cinnabar' | 'breeze' | 'violet';
export function normalizeAppearancePreset(value: unknown): AppearancePreset {
    if (value === 'graphite') return 'ink';
    if (value === 'theme') return 'obsidian';
    if (value === 'wash' || value === 'whale') return 'breeze';
    if (value === 'gold') return 'cinnabar';
    // `white` was a second "no override" option beside `obsidian`; it no longer exists.
    return value === 'cinnabar' || value === 'breeze' || value === 'violet' || value === 'ink'
        ? value : 'obsidian';
}

/**
 * Structure painted under the map. Independent of the palette, so changing hue never changes the
 * surface and vice versa. `dots` is the default because a fresh install should not look like a
 * flat colour swatch, and a dot grid is the least opinionated way to read as a surface.
 */
export type SurfaceMaterial = 'none' | 'dots' | 'grid' | 'paper';
export function normalizeSurfaceMaterial(value: unknown): SurfaceMaterial {
    return value === 'none' || value === 'grid' || value === 'paper' ? value : 'dots';
}

/** Card and heading face: follow the vault, or set an explicit serif display face. */
export type MindmapTypeface = 'match' | 'serif';
export function normalizeMindmapTypeface(value: unknown): MindmapTypeface {
    return value === 'serif' ? 'serif' : 'match';
}


/**
 * Dye the branches with the shared palette, or hold every branch to the preset's single
 * accent. Palette mode is what gives each top-level branch its stable identity.
 */
export type BranchColourMode = 'palette' | 'monochrome';
export function normalizeBranchColourMode(value: unknown): BranchColourMode {
    return value === 'monochrome' ? 'monochrome' : 'palette';
}

export interface OrganicSettings {
    autoRefresh: boolean;
    animation: boolean;
    animationDuration: number;
    pngScale: number;
    rememberState: boolean;
    defaultLayout: 'organic-radial' | 'organic-horizontal' | 'compact-organic';
}
export function normalizeOrganicSettings(value: unknown): OrganicSettings {
    const input = value && typeof value === 'object' ? value as Partial<OrganicSettings> : {};
    return { pngScale: input.pngScale === 1 || input.pngScale === 3 ? input.pngScale : 2, animation: input.animation !== false,
        animationDuration: typeof input.animationDuration === 'number' && Number.isFinite(input.animationDuration) ? Math.max(0, Math.min(500, input.animationDuration)) : 200,
        autoRefresh: input.autoRefresh !== false, rememberState: input.rememberState !== false, defaultLayout:
        input.defaultLayout === 'organic-horizontal' || input.defaultLayout === 'compact-organic' ? input.defaultLayout : 'organic-radial' };
}
