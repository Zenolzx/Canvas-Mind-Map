import { Extension, StateEffect, StateField } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { normalizeEditorText, SectionTextBuffer, SectionTextChange } from '../document';

const restoreRaw = StateEffect.define<string>();
export function sectionTextExtension(raw: string, eol: '\n' | '\r\n' | '\r'): { field: StateField<SectionTextBuffer>; extension: Extension } {
    const field = StateField.define<SectionTextBuffer>({
        create: () => new SectionTextBuffer(raw, eol),
        update: (buffer, tr) => {
            if (tr.docChanged) {
                const changes: SectionTextChange[] = [];
                tr.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert: insert.toString() }));
                buffer = buffer.apply(tr.startState.doc.toString(), changes);
            }
            for (const effect of tr.effects) if (effect.is(restoreRaw) && normalizeEditorText(effect.value) === tr.newDoc.toString()) {
                buffer = new SectionTextBuffer(effect.value, eol);
            }
            return buffer;
        },
    });
    return { field, extension: [field, invertedEffects.of(tr => tr.docChanged ? [restoreRaw.of(tr.startState.field(field).sourceText)] : [])] };
}
