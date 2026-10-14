/** Small, bounded backdrop offset. Rounded values avoid style writes during tiny pans. */
const previous = new WeakMap<Element, string>();
const origin = new WeakMap<Element, { x: number; y: number; zoom: number }>();

export function updateAppearanceParallax(surface: Element, x: number, y: number, zoom: number): void {
    let start = origin.get(surface);
    if (!start) { start = { x, y, zoom }; origin.set(surface, start); }
    const bounded = (value: number) => Math.round(Math.max(-16, Math.min(16, value)) * 2) / 2;
    const px = bounded((x - start.x) * .018 + (zoom - start.zoom) * 2);
    const py = bounded((y - start.y) * .018 - (zoom - start.zoom) * 2);
    const key = `${px},${py}`;
    if (previous.get(surface) === key) return;
    previous.set(surface, key);
    const style = (surface as HTMLElement | SVGElement).style;
    style.setProperty('--cmm-parallax-x', `${px}px`);
    style.setProperty('--cmm-parallax-y', `${py}px`);
}

export function resetAppearanceParallax(surface: Element): void {
    origin.delete(surface);
    previous.delete(surface);
    const style = (surface as HTMLElement | SVGElement).style;
    style.removeProperty('--cmm-parallax-x');
    style.removeProperty('--cmm-parallax-y');
}
