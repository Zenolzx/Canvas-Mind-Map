import { App, Modal } from 'obsidian';

export function chooseDeletion(app: App, title: string, words: number, children: number): Promise<'subtree' | 'promoteChildren' | undefined> {
    return new Promise(resolve => {
        class DeleteDialog extends Modal {
            private choice?: 'subtree' | 'promoteChildren';
            onOpen(): void {
                this.titleEl.textContent = `删除“${title}”？`;
                this.contentEl.createEl('p', { text: `整个章节包含 ${words} 字/词，${children} 个子章节。` });
                this.contentEl.createEl('p', { text: '提升子章节会保留直属正文在原位置，并将子章节提升到当前层级。' });
                const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
                actions.createEl('button', { text: '取消' }).onclick = () => this.close();
                actions.createEl('button', { text: '保留正文并提升子章节' }).onclick = () => { this.choice = 'promoteChildren'; this.close(); };
                actions.createEl('button', { text: '删除整个章节', cls: 'mod-warning' }).onclick = () => { this.choice = 'subtree'; this.close(); };
            }
            onClose(): void { resolve(this.choice); }
        }
        new DeleteDialog(app).open();
    });
}

/** Closing a leaf must not discard a rejected/unfinished body draft. */
export function showDraftRecovery(app: App, title: string, raw: string): void {
    class Recovery extends Modal {
        onOpen(): void {
            this.titleEl.textContent = `未保存的正文：${title}`;
            this.contentEl.createEl('p', { text: '保存未完成。以下内容保留在此窗口，请复制后再关闭。原笔记未被强行覆盖。' });
            const text = this.contentEl.createEl('textarea'); text.value = raw; text.readOnly = true;
            text.classList.add('cmm-writing-draft-recovery');
            this.contentEl.createEl('button', { text: '全选正文' }).onclick = () => { text.focus(); text.select(); };
        }
    }
    new Recovery(app).open();
}

export function confirmDiscardDraft(app: App, raw: string): Promise<boolean> {
    return new Promise(resolve => {
        class Discard extends Modal {
            private discard = false;
            onOpen(): void {
                this.titleEl.textContent = '刷新前处理未保存正文';
                this.contentEl.createEl('p', { text: '刷新将读取原笔记。请先复制需要保留的草稿，或取消并继续编辑。' });
                const text = this.contentEl.createEl('textarea'); text.value = raw; text.readOnly = true;
                text.classList.add('cmm-writing-draft-discard');
                this.contentEl.createEl('button', { text: '全选草稿' }).onclick = () => { text.focus(); text.select(); };
                this.contentEl.createEl('button', { text: '取消' }).onclick = () => this.close();
                this.contentEl.createEl('button', { text: '放弃此草稿并刷新', cls: 'mod-warning' }).onclick = () => { this.discard = true; this.close(); };
            }
            onClose(): void { resolve(this.discard); }
        }
        new Discard(app).open();
    });
}
