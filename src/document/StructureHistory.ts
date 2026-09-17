import { DocumentStructure } from './DocumentStructure';
import { PreparedTransaction } from './DocumentStructureTransactionService';
import { StructureViewSnapshot } from './StructureOperation';

export interface HistoryEntry {
    readonly before: DocumentStructure;
    readonly after: DocumentStructure;
    readonly beforeView?: StructureViewSnapshot;
    readonly afterView?: StructureViewSnapshot;
}

function snapshot(view?: StructureViewSnapshot): StructureViewSnapshot | undefined {
    return view && Object.freeze({ ...view, collapsed: Object.freeze([...view.collapsed]), center: Object.freeze({ ...view.center }) });
}

/** Session-only bounded history. A failed commit never advances either stack. */
export class StructureHistory {
    private undoEntries: HistoryEntry[] = [];
    private redoEntries: HistoryEntry[] = [];
    constructor(private readonly limit = 100, private readonly maxCharacters = 16 * 1024 * 1024) {}
    get canUndo(): boolean { return this.undoEntries.length > 0; }
    get canRedo(): boolean { return this.redoEntries.length > 0; }
    peekUndo(): HistoryEntry | undefined { return this.undoEntries[this.undoEntries.length - 1]; }
    peekRedo(): HistoryEntry | undefined { return this.redoEntries[this.redoEntries.length - 1]; }
    record(transaction: PreparedTransaction, beforeView?: StructureViewSnapshot, afterView?: StructureViewSnapshot): void {
        if (transaction.before.text === transaction.after.text) return;
        this.undoEntries.push(Object.freeze({ before: transaction.before, after: transaction.after,
            beforeView: snapshot(beforeView), afterView: snapshot(afterView) }));
        this.redoEntries = [];
        let size = this.undoEntries.reduce((sum, entry) => sum + entry.before.text.length + entry.after.text.length, 0);
        while (this.undoEntries.length > this.limit || (size > this.maxCharacters && this.undoEntries.length > 0)) {
            const removed = this.undoEntries.shift()!; size -= removed.before.text.length + removed.after.text.length;
        }
    }
    didUndo(): void { const entry = this.undoEntries.pop(); if (entry) this.redoEntries.push(entry); }
    didRedo(): void { const entry = this.redoEntries.pop(); if (entry) this.undoEntries.push(entry); }
    clear(): void { this.undoEntries = []; this.redoEntries = []; }
}
