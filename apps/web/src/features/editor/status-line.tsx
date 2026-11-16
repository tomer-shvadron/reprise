import { useStore } from 'zustand';

import type { DocumentStore } from '@/state/document';
import type { EditingStore } from '@/state/editing';
import type { SelectionStore } from '@/state/selection';
import type { UiStore } from '@/state/ui';

import { resolveCursor } from './cursor';
import type { EntryStore } from './entry-store';
import { toggleEffectsPanel } from './picker-commands';
import { rhythmLabel } from './rhythm';

export interface EditStatusLineProps {
  entry: EntryStore;
  editing: EditingStore;
  selection: SelectionStore;
  document: DocumentStore;
  /** With it, the line carries an Effects button that toggles the right panel's effects view. */
  ui?: UiStore;
}

/** Toggles the right panel's effects view; a click leaves focus on the score. */
function EffectsButton({ ui }: { ui: UiStore }) {
  const shown = useStore(
    ui,
    (state) => state.panels.rightPanel && state.rightPanelView === 'effects',
  );
  return (
    <button
      type="button"
      aria-pressed={shown}
      className="hover:bg-muted text-foreground aria-pressed:bg-muted ml-auto rounded px-1.5 py-0.5"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        toggleEffectsPanel(ui);
      }}
    >
      Effects
    </button>
  );
}

/**
 * The entry state as text: insert or overwrite, the voice, the current duration and where the
 * cursor is, then the digit waiting for a second one and the last refusal. Shown only while
 * editing, in flow below the score. Only the refusal is a live region, so it is announced and the
 * position that changes with every key is not.
 */
export function EditStatusLine({ entry, editing, selection, document, ui }: EditStatusLineProps) {
  const isEditing = useStore(editing, (state) => state.editing);
  const { rhythm, mode, pending, message, tone } = useStore(entry);
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
      {/* Only the message is announced; the position line changes with every key. */}
      <span
        role="status"
        aria-live="polite"
        className={
          tone === 'notice' ? 'text-foreground font-medium' : 'text-destructive font-medium'
        }
      >
        {message}
      </span>
      {ui && <EffectsButton ui={ui} />}
    </div>
  );
}
