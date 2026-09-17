import { DocumentCommitAdapter, CommitSource } from './DocumentCommitAdapter';
import { DocumentStructure, StructureError } from './DocumentStructure';
import { DocumentStructureParser } from './DocumentStructureParser';
import { DocumentStructureTransactionService, PreparedTransaction } from './DocumentStructureTransactionService';
import { StructureHistory } from './StructureHistory';
import { StructureOperation, StructureViewSnapshot } from './StructureOperation';

export interface CommitResult { readonly document: DocumentStructure; readonly view?: StructureViewSnapshot }

/** One coordinator per open document session. It never retries a stale user intent automatically. */
export class DocumentChangeCoordinator {
    private pending: Promise<unknown> = Promise.resolve();
    private current: DocumentStructure;
    private expectedSelfText?: string;
    private blocked = false;
    readonly history = new StructureHistory();
    constructor(initial: DocumentStructure, private adapter: DocumentCommitAdapter,
        private service = new DocumentStructureTransactionService(), private parser = new DocumentStructureParser()) { this.current = initial; }
    get document(): DocumentStructure { return this.current; }
    get needsRefresh(): boolean { return this.blocked; }

    prepare(operation: StructureOperation): PreparedTransaction {
        if (this.blocked) throw new StructureError('refresh-required', 'Refresh the source before making another structural edit.');
        return this.service.prepare(this.current, operation);
    }

    commit(transaction: PreparedTransaction, beforeView?: StructureViewSnapshot, afterView?: StructureViewSnapshot): Promise<CommitResult> {
        return this.enqueue(async () => {
            this.assertCurrent(transaction.before);
            // Re-prepare at the trust boundary. Mutated caller-owned plans cannot bypass validation.
            const verified = this.service.prepare(this.current, transaction.operation);
            if (verified.after.text !== transaction.after.text)
                throw new StructureError('invalid-transaction', 'Prepared transaction does not match its operation.');
            if (transaction.before.text === transaction.after.text) return { document: this.current };
            await this.write(transaction.before.text, transaction.after.text);
            this.current = transaction.after;
            this.history.record(transaction, beforeView, afterView);
            return { document: this.current, view: afterView };
        });
    }

    undo(): Promise<CommitResult> { return this.restore('undo'); }
    redo(): Promise<CommitResult> { return this.restore('redo'); }

    /** Called after a modification notification; events are hints, current contents are evidence. */
    observeSource(): Promise<'unchanged' | 'self' | 'external'> {
        return this.enqueue(async () => {
            const source = await this.adapter.read(this.current.sourcePath);
            if (!source.editorsSynchronized) { this.blocked = true; return 'external'; }
            if (source.text === this.expectedSelfText && source.text === this.current.text) {
                this.expectedSelfText = undefined; return 'self';
            }
            if (source.text === this.current.text) return 'unchanged';
            this.blocked = true; this.expectedSelfText = undefined;
            return 'external';
        });
    }

    refresh(): Promise<DocumentStructure> {
        return this.enqueue(async () => {
            const source = await this.adapter.read(this.current.sourcePath);
            this.assertSynchronized(source);
            const same = source.text === this.current.text;
            const identities = same ? new Map(this.current.order.map(id => [this.current.sections.get(id)!.heading.start, id])) : undefined;
            this.current = this.parser.parse(source.text, { sourcePath: this.current.sourcePath, revision: this.current.revision + 1, identities });
            // External undo/redo is not rebased by matching text: refreshed history starts a new session epoch.
            this.history.clear(); this.blocked = false; this.expectedSelfText = undefined;
            return this.current;
        });
    }
    /** A host rename changes identity/path, never source bytes. Old-path history is retired. */
    relocate(sourcePath: string): Promise<DocumentStructure> {
        return this.enqueue(async () => {
            this.blocked = true; this.expectedSelfText = undefined; this.history.clear();
            this.current = this.parser.parse(this.current.text, { sourcePath, revision: this.current.revision + 1,
                identities: new Map(this.current.order.map(id => [this.current.sections.get(id)!.heading.start, id])) });
            const source = await this.adapter.read(sourcePath);
            this.assertSynchronized(source);
            if (source.text !== this.current.text) throw new StructureError('source-conflict', 'The renamed note also changed. Refresh before editing.');
            this.blocked = false; return this.current;
        });
    }

    private restore(direction: 'undo' | 'redo'): Promise<CommitResult> {
        return this.enqueue(async () => {
            if (this.blocked) throw new StructureError('refresh-required', 'Refresh the externally changed source before undo/redo.');
            const entry = direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo();
            if (!entry) throw new StructureError('empty-history', `Nothing to ${direction}.`);
            const expected = direction === 'undo' ? entry.after : entry.before;
            const desired = direction === 'undo' ? entry.before : entry.after;
            if (this.current.text !== expected.text) throw new StructureError('history-conflict', 'Undo/redo does not match the current document.');
            const next = this.parser.parse(desired.text, { sourcePath: this.current.sourcePath, revision: this.current.revision + 1,
                identities: new Map(desired.order.map(id => [desired.sections.get(id)!.heading.start, id])) });
            await this.write(expected.text, next.text);
            this.current = next;
            if (direction === 'undo') this.history.didUndo(); else this.history.didRedo();
            return { document: this.current, view: direction === 'undo' ? entry.beforeView : entry.afterView };
        });
    }

    private assertCurrent(before: DocumentStructure): void {
        if (this.blocked) throw new StructureError('refresh-required', 'Refresh the source before applying this operation.');
        if (before.sourcePath !== this.current.sourcePath || before.revision !== this.current.revision || before.text !== this.current.text)
            throw new StructureError('stale-transaction', 'This transaction belongs to an older document version.');
    }
    private assertSynchronized(source: CommitSource): void {
        if (!source.editorsSynchronized) {
            this.blocked = true;
            throw new StructureError('editor-conflict', 'Another editor has unsynchronized content. Refresh after it has saved.');
        }
    }
    private async write(before: string, after: string): Promise<void> {
        try {
            const result = await this.adapter.process(this.current.sourcePath, current => {
                this.assertSynchronized(current);
                if (current.text !== before) {
                    this.blocked = true;
                    throw new StructureError('source-conflict', 'The source note changed outside Mind Map Writing mode. Refresh or cancel the operation.');
                }
                return after;
            });
            if (result !== after) throw new StructureError('commit-mismatch', 'The host returned an unexpected source after committing. Refresh required.');
            this.expectedSelfText = after;
        } catch (error) {
            // IO may fail before OR after writing. Never blindly roll back or assume a retry is safe.
            this.blocked = true; this.expectedSelfText = undefined;
            throw error;
        }
    }
    private enqueue<T>(action: () => Promise<T>): Promise<T> {
        const next = this.pending.catch(() => {}).then(action);
        this.pending = next; return next;
    }
}
