import { ambientHost, windowTimers } from '../design/timers';

/** Coalesces vault modifications. The view's revision guard protects asynchronous reads. */
export class OrganicAutoRefreshController {
    private timer?: ReturnType<typeof setTimeout>;
    private closed = false;
    private timers: ReturnType<typeof windowTimers>;
    constructor(private refresh: () => Promise<void>, private enabled: () => boolean,
        private invalidate: () => void, private delay = 500, private onError?: (error: unknown) => void,
        host: () => Window | undefined = ambientHost) {
        this.timers = windowTimers(host);
    }
    changed(): void {
        if (this.closed || !this.enabled()) return;
        this.invalidate();
        this.timers.clear(this.timer);
        this.timer = this.timers.set(() => {
            this.timer = undefined;
            if (!this.closed && this.enabled()) void this.refresh().catch(error => {
                // A background refresh that fails must say so; otherwise the map silently
                // keeps showing a stale document while the note on disk has moved on.
                console.error('Organic auto-refresh failed', error);
                this.onError?.(error);
            });
        }, this.delay);
    }
    cancel(): void { this.timers.clear(this.timer); this.timer = undefined; }
    close(): void { this.closed = true; this.cancel(); }
}
