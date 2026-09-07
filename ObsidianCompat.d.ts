import 'obsidian';

// Obsidian API 1.13.1 declares these classes as HistoryHandler but omits the
// method in their declarations. All three implementations are present in the
// installed app.js (verified 2026-09-07). Keep the strict tsc gate enabled.
declare module 'obsidian' {
    interface Menu { onHistoryBack(): void }
    interface Modal { onHistoryBack(): void }
    interface PopoverSuggest<T> { onHistoryBack(): void }
}
