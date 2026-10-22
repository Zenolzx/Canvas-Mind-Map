import type { Plugin } from 'obsidian';

/** Canvas leaves can materialize after layout-ready, including in secondary windows. */
export function watchCanvasIntegration(plugin: Pick<Plugin, 'app' | 'register' | 'registerEvent'>,
    install: () => boolean, ready: () => void, failed: (error: unknown) => void): void {
    let stopped = false, running = false, installed = false;
    let timers: number[] = [];
    const errors = new Set<string>();
    const attempt = () => {
        if (stopped || running) return;
        running = true;
        try {
            if (install()) {
                if (!installed) { installed = true; ready(); }
                errors.clear();
            }
        } catch (error) {
            const key = String(error);
            if (!errors.has(key)) { errors.add(key); failed(error); }
        } finally { running = false; }
    };
    const schedule = () => {
        if (stopped) return;
        timers.forEach(id => window.clearTimeout(id));
        attempt();
        // Leaf-change can precede deferred view construction. Retry without polling forever.
        timers = [0, 100, 500].map(delay => window.setTimeout(attempt, delay));
    };
    plugin.registerEvent(plugin.app.workspace.on('layout-change', schedule));
    plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', schedule));
    plugin.registerEvent(plugin.app.workspace.on('file-open', schedule));
    plugin.registerEvent(plugin.app.workspace.on('window-open', schedule));
    plugin.register(() => { stopped = true; timers.forEach(id => window.clearTimeout(id)); timers = []; });
    plugin.app.workspace.onLayoutReady(schedule);
    schedule();
}
