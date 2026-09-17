/** Coalesces vault modifications. The view's revision guard protects asynchronous reads. */
export class OrganicAutoRefreshController {
    private timer?: ReturnType<typeof setTimeout>;
    private closed = false;
    constructor(private refresh: () => Promise<void>, private enabled: () => boolean,
        private invalidate: () => void, private delay = 500) {}
    changed(): void {
        if (this.closed || !this.enabled()) return;
        this.invalidate();
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (!this.closed && this.enabled()) void this.refresh().catch(console.error);
        }, this.delay);
    }
    cancel(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
    close(): void { this.closed = true; this.cancel(); }
}
