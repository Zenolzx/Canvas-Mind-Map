/**
 * Type scale for the SVG surfaces.
 *
 * Presentation attributes cannot read CSS custom properties, so the depth ladder has to exist as
 * numbers here. `styles.css` declares the same steps as `--cmm-font-*` for the HTML surfaces; the
 * two lists are kept in step by `scripts/verify-design-tokens.cjs`.
 */
export const TYPE_SCALE = [30, 21, 17, 15, 14, 13, 12] as const;

export const WEIGHT = { display: 650, strong: 500, body: 400 } as const;

/** Line box multiplier for wrapped card titles; also the baseline step. */
export const LINE_HEIGHT = 1.4;

/** Small-caps label above a root title, and the tracking it is set with. */
export const EYEBROW_SIZE = 10;
export const EYEBROW_TRACKING = 0.12;
