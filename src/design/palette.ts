/**
 * Shared colour identity for mind maps.
 *
 * Organic, Native Canvas and Composer-Sketch previously each declared their own palette with
 * near-identical hues but different hex values, so the same document looked different in
 * different modes. These are the single source.
 *
 * Branch hues are deliberately desaturated: they appear on connectors only, and the structure
 * stays readable without them. Two sets exist because one hue cannot be legible on both a pale
 * and a dark page. `styles.css` mirrors both lists as `--cmm-branch-1` … `--cmm-branch-8`; the
 * SVG surfaces reference those custom properties so a theme switch needs no relayout.
 */

/** Per-top-level-branch palette for light surfaces. Mirrored by `styles.css`. */
export const BRANCH_PALETTE_LIGHT = [
    '#5f8c86', '#a97648', '#91637a', '#6b7d52', '#66759f', '#a2665b', '#7d6796', '#5a7f8d',
] as const;

/** The same hues lightened for dark surfaces. Mirrored by `styles.css`. */
export const BRANCH_PALETTE_DARK = [
    '#7fb3a8', '#c79a6a', '#b98ba3', '#8fa877', '#8f9fd1', '#c4887c', '#a58cbe', '#7fb0b8',
] as const;

/** Softer palette for hand-drawn Sketch strokes, which sit on paper rather than a card. */
export const SKETCH_PALETTE = ['#668f86', '#b98772', '#8586a8', '#989e70', '#9b7790', '#718fa8'];

/** Paper tints for Sketch free notes. */
export const SKETCH_NOTE_PAPERS = ['#fffaf0', '#f4faf5', '#fbf5f1', '#f6f6fb'];

/** The custom property that resolves to a branch hue in the active theme. */
export function branchToken(index: number): string {
    const step = ((index % BRANCH_PALETTE_LIGHT.length) + BRANCH_PALETTE_LIGHT.length) % BRANCH_PALETTE_LIGHT.length;
    return `var(--cmm-branch-${step + 1})`;
}

/** Pick the first unused branch token, then fall back to a stable position-based choice. */
export function pickBranchToken(used: ReadonlySet<string>, index: number): string {
    for (let step = 0; step < BRANCH_PALETTE_LIGHT.length; step++) {
        const token = branchToken(step);
        if (!used.has(token)) return token;
    }
    return branchToken(index);
}

/** Concrete colour, for surfaces that need a value rather than a token (Canvas DOM nodes). */
export function pickPaletteColour(used: ReadonlySet<string>, index: number,
    palette: readonly string[] = BRANCH_PALETTE_LIGHT): string {
    const first = palette.find(colour => !used.has(colour));
    // The palette is a non-empty literal; the fallback keeps this total for any array.
    return first ?? palette[index % palette.length] ?? palette[0] ?? '#888888';
}
