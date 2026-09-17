/** Must describe live editor buffers as well as the file. Unknown synchronization means false. */
export interface CommitSource {
    readonly text: string;
    readonly editorsSynchronized: boolean;
}

/**
 * Host boundary. process must serialize read/check/write for this path and invoke transform
 * synchronously on the latest source. Throwing from transform must perform no write.
 * Recheck live editor synchronization in that callback, not only during an earlier read.
 * The pure engine declares only this contract. The Obsidian implementation lives in src/writing.
 */
export interface DocumentCommitAdapter {
    read(sourcePath: string): Promise<CommitSource>;
    process(sourcePath: string, transform: (current: CommitSource) => string): Promise<string>;
}
