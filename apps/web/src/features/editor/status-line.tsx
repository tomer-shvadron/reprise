import { useStore } from 'zustand';

import type { DocumentStore } from '@/state/document';
import type { EditingStore } from '@/state/editing';
import type { SelectionStore } from '@/state/selection';

import { resolveCursor } from './cursor';
import type { EntryStore } from './entry-store';
import { rhythmLabel } from './rhythm';

export interface EditStatusLineProps {
  entry: EntryStore;
  editing: EditingStore;
  selection: SelectionStore;
  document: DocumentStore;
}

/**
 * The entry state as text: insert or overwrite, the voice, the current duration and where the
 * cursor is, then the digit waiting for a second one and the last refusal. Shown only while
 * editing, in flow below the score. Only the refusal is a live region, so it is announced and the
 * position that changes with every key is not.
 */
export function EditStatusLine({ entry, editing, selection, document }: EditStatusLineProps) {
  const isEditing = useStore(editing, (state) => state.editing);
  const { rhythm, mode, pending, message } = useStore(entry);
  const cursor = useStore(selection, (state) => state.cursor);
  const score = useStore(document, (state) => state.score);
  if (!isEditing) return null;
  const at = cursor && score && resolveCursor(score, cursor);
  const parts = [
    mode === 'insert' ? 'Insert' : 'Overwrite',
    `Voice ${String((cursor?.voice ?? 0) + 1)}`,
    rhythmLabel(rhythm),
    ...(at
      ? [
          `Bar ${String(at.bar + 1)}`,
          cursor.beat === undefined ? 'End of bar' : `Beat ${String(at.stop + 1)}`,
          ...(cursor.string > 0 ? [`String ${String(cursor.string)}`] : []),
        ]
      : []),
  ];
  return (
    <div
      data-testid="edit-status"
      className="text-muted-foreground bg-background flex shrink-0 flex-wrap items-center gap-x-2 border-t px-4 py-1 text-xs tabular-nums"
    >
      <span>{parts.join(' · ')}</span>
      {pending && <span className="text-foreground font-medium">Fret {String(pending.fret)}…</span>}
      {/* Only the refusal is announced; the position line changes with every key. */}
      <span role="status" aria-live="polite" className="text-destructive font-medium">
        {message}
      </span>
    </div>
  );
}
