export class OrganicViewportController {
    private cancelFollow?: () => void;
    cancel(): void { this.cancelFollow?.(); this.cancelFollow = undefined; }
    scale = 1;
    offset = { x: 0, y: 0 };
    zoom(factor: number, x: number, y: number): void {
        const next = Math.max(0.05, Math.min(4, this.scale * factor)), ratio = next / this.scale;
        this.offset = { x: x - (x - this.offset.x) * ratio, y: y - (y - this.offset.y) * ratio };
        this.scale = next;
    }
    fit(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number): void {
        this.scale = Math.max(0.05, Math.min(1.25, width / bounds.width, height / bounds.height));
        this.center({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, width, height);
    }
    center(point: { x: number; y: number }, width: number, height: number): void {
        this.offset = { x: width / 2 - point.x * this.scale, y: height / 2 - point.y * this.scale };
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
        let frame = 0; const start = win.performance.now();
        this.cancelFollow = () => { win.cancelAnimationFrame(frame); paint(target); };
        const tick = (now: number) => {
            const fraction = Math.min(1, (now - start) / duration), t = 1 - Math.pow(1 - fraction, 3);
            paint({ x: old.x + (target.x - old.x) * t, y: old.y + (target.y - old.y) * t });
            if (fraction < 1) frame = win.requestAnimationFrame(tick); else this.cancelFollow = undefined;
        };
        frame = win.requestAnimationFrame(tick);
    }
}
