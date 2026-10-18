/**
 * Window-bound timers.
 *
 * Obsidian can host a view in a popout window. A bare `setTimeout` schedules on the main
 * window, so a debounced autosave belonging to a popout can fire after that popout closes,
 * or fire against the wrong document. `obsidianmd/prefer-window-timers` flags exactly this.
 *
 * The window is resolved lazily rather than captured, and `setTimeout` is always called as a
 * method of that window: calling an unbound `win.setTimeout(...)` throws.
 */
export interface WindowTimers {
    set(handler: () => void, delay: number): ReturnType<typeof setTimeout>;
    clear(handle: ReturnType<typeof setTimeout> | undefined): void;
}

/**
 * The ambient window, falling back to the global object. Resolved per call so a suite that
 * installs a fake window after import still gets it.
 */
function ambientWindow(): Window {
    return (typeof window !== 'undefined' ? window : globalThis) as unknown as Window;
}

/**
 * A `host` getter that is safe in a bare sandbox. Tests evaluate the bundle in a VM context
 * with no DOM, where a bare `window` reference would throw.
 */
export function ambientHost(): Window | undefined {
    return ambientWindow();
}

export function windowTimers(host: () => Window | undefined): WindowTimers {
    const resolve = () => host() ?? ambientWindow();
    return {
        set(handler, delay) {
            return resolve().setTimeout(handler, delay) as unknown as ReturnType<typeof setTimeout>;
        },
        clear(handle) {
            if (handle === undefined) return;
            resolve().clearTimeout(handle as unknown as number);
        },
    };
}
