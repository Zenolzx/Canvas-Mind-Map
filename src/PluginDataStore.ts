/** One ordered writer for settings and view state. A failed write does not poison the queue. */
export class PluginDataStore {
    private pending: Promise<void> = Promise.resolve();
    constructor(private snapshot: () => unknown, private write: (data: unknown) => Promise<void>) {}
    save(): Promise<void> {
        const data = JSON.parse(JSON.stringify(this.snapshot()));
        const next = this.pending.catch(() => {}).then(() => this.write(data));
        this.pending = next;
        return next;
    }
}
