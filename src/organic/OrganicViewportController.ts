export class OrganicViewportController {
    private cancelFollow?: () => void;
    cancel(): void { this.cancelFollow?.(); this.cancelFollow = undefined; }
    scale = 1;
    offset = { x: 0, y: 0 };
    pan(x: number, y: number): void {
        this.cancel(); this.offset = { x: this.offset.x + x, y: this.offset.y + y };
    }
    zoom(factor: number, x: number, y: number): void {
        this.cancel();
        const next = Math.max(0.05, Math.min(4, this.scale * factor)), ratio = next / this.scale;
        this.offset = { x: x - (x - this.offset.x) * ratio, y: y - (y - this.offset.y) * ratio };
        this.scale = next;
    }
    fit(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number): void {
        this.cancel();
        // Degenerate bounds (a single node, or a pane that has not been measured yet) would make
        // this Infinity or NaN; fall back to a neutral scale instead of corrupting the transform.
        const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
        const boundsWidth = safe(bounds.width), boundsHeight = safe(bounds.height);
        const paneWidth = safe(width), paneHeight = safe(height);
        const candidates = [1.25];
        if (boundsWidth && paneWidth) candidates.push(paneWidth / boundsWidth);
        if (boundsHeight && paneHeight) candidates.push(paneHeight / boundsHeight);
        this.scale = Math.max(0.05, Math.min(...candidates));
        const centre = { x: bounds.x + boundsWidth / 2, y: bounds.y + boundsHeight / 2 };
        this.center(Number.isFinite(centre.x) && Number.isFinite(centre.y) ? centre : { x: 0, y: 0 }, width, height);
    }
    center(point: { x: number; y: number }, width: number, height: number): void {
        this.cancel();
        const w = Number.isFinite(width) ? width : 0, h = Number.isFinite(height) ? height : 0;
        this.offset = { x: w / 2 - point.x * this.scale, y: h / 2 - point.y * this.scale };
    }
    snapshot(width: number, height: number) {
        return { zoom: this.scale, center: { x: (width / 2 - this.offset.x) / this.scale,
            y: (height / 2 - this.offset.y) / this.scale } };
    }
    follow(point: { x: number; y: number }, width: number, height: number, win: Window | null | undefined,
        duration: number, paint: (offset: { x: number; y: number }) => void): void {
        this.cancel(); const old = { ...this.offset }; this.center(point, width, height);
        const target = { ...this.offset };
        if (!duration || !win?.requestAnimationFrame || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { paint(target); return; }
        this.offset = old;
        let frame = 0; const start = win.performance.now();
        this.cancelFollow = () => { win.cancelAnimationFrame(frame); };
        const tick = (now: number) => {
            const fraction = Math.min(1, (now - start) / duration), t = 1 - Math.pow(1 - fraction, 3);
            this.offset = { x: old.x + (target.x - old.x) * t, y: old.y + (target.y - old.y) * t };
            paint(this.offset);
            if (fraction < 1) frame = win.requestAnimationFrame(tick); else this.cancelFollow = undefined;
        };
        frame = win.requestAnimationFrame(tick);
    }
}
