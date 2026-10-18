/**
 * Geometry constants shared by the SVG surfaces.
 *
 * The CSS side declares the same radii as `--cmm-radius-*` custom properties. SVG
 * presentation attributes cannot read custom properties, so only the four steps that the
 * renderer needs are mirrored here as numbers. Keep the two lists in step.
 */
export const RADIUS = {
    /** Checkboxes and small badges. */
    xs: 4,
    /** Small controls and inline rows. */
    s: 6,
    /** Map cards; also the fallback for `--cmm-radius-m`. */
    m: 9,
    /** Panels and floating trays. */
    l: 14,
    /** Fully rounded: disclosure badges, the add-child button, pills. */
    pill: 999,
} as const;
