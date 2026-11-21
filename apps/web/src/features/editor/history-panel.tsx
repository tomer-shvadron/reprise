import { cn } from 'cn';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { CommandTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';

import { historyLabel } from './history-labels';

type Row = { label: string; kind: 'start' | 'done' | 'undone' };

/** A click must not take focus from the page: typing frets carries on after it. */
const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};

/**
 * The right panel's history: the start state, every edit that is applied (oldest first, the
 * newest marked `aria-current="step"`), then the edits Redo would bring back, dimmed. A row
 * jumps there with repeated undo or redo, so a grouped edit (a paste, an entry) is one row.
 * The list is one tab stop: arrows and Home/End move, Enter, Space or a click jumps.
 */
export function HistoryPanel() {
  const { document } = useAppServices();
  const labels = useStore(document, (state) => state.historyLabels);
  const open = useStore(document, (state) => state.score !== undefined);
  // A song made in the app has no file until it is saved.
  const made = useStore(document, (state) => state.file === undefined);
  const headingId = useId();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [tab, setTab] = useState<{ index: number; current: number }>();

  // Newest first on both stacks; the redo stack's first entry is the very next redo.
  const list: Row[] = [
    { label: made ? 'New song' : 'Opened', kind: 'start' },
    ...[...labels.undo].reverse().map((name): Row => ({ label: historyLabel(name), kind: 'done' })),
    ...labels.redo.map((name): Row => ({ label: historyLabel(name), kind: 'undone' })),
  ];
  const current = labels.undo.length;
  const tabbable = tab?.current === current ? tab.index : current;

  useEffect(() => {
    // jsdom has no scrollIntoView.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    rows.current[current]?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const jump = (index: number) => {
    const steps = index - document.getState().historyLabels.undo.length;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      if (steps < 0) document.getState().undo();
      else document.getState().redo();
    }
  };

  const move = (to: number) => {
    const clamped = Math.min(Math.max(to, 0), list.length - 1);
    setTab({ index: clamped, current });
    rows.current[clamped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const target: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: list.length - 1,
    };
    const to = target[event.key];
    if (to !== undefined) {
      event.preventDefault();
      move(to);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      jump(index);
    }
  };

  const undoLabel = labels.undo[0];
  const redoLabel = labels.redo[0];
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <h2
        id={headingId}
        className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase"
      >
        History
      </h2>
      <div className="flex gap-2 border-t px-3 py-2">
        {/* The click calls the document directly: the command's run first undoes a focused text field's typing. */}
        <CommandTooltip command="edit.undo" label="Undo" whenUnbound="none">
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 whitespace-normal"
            disabled={undoLabel === undefined}
            onMouseDown={keepFocus}
            onClick={() => {
              document.getState().undo();
            }}
          >
            {undoLabel === undefined ? 'Undo' : `Undo ${historyLabel(undoLabel)}`}
          </Button>
        </CommandTooltip>
        <CommandTooltip command="edit.redo" label="Redo" whenUnbound="none">
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 whitespace-normal"
            disabled={redoLabel === undefined}
            onMouseDown={keepFocus}
            onClick={() => {
              document.getState().redo();
            }}
          >
            {redoLabel === undefined ? 'Redo' : `Redo ${historyLabel(redoLabel)}`}
          </Button>
        </CommandTooltip>
      </div>
      {!open ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">Open a file to see its changes.</p>
      ) : (
        <>
          {labels.undo.length === 0 && labels.redo.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-sm">No changes yet</p>
          )}
          <ol
            role="listbox"
            aria-labelledby={headingId}
            className="min-h-0 flex-1 overflow-y-auto border-t"
          >
            {list.map((row, index) => (
              <li
                // The rows have no identity beyond their place, and the list only ever changes at its ends.
                key={index}
                ref={(element) => {
                  rows.current[index] = element;
                }}
                role="option"
                aria-selected={index === current}
                aria-current={index === current ? 'step' : undefined}
                tabIndex={index === tabbable ? 0 : -1}
                className={cn(
                  'hover:bg-muted focus-visible:ring-ring cursor-pointer px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset',
                  row.kind === 'undone' && 'text-muted-foreground italic',
                  index === current && 'bg-muted font-medium',
                )}
                onMouseDown={keepFocus}
                onClick={() => {
                  jump(index);
                }}
                onFocus={() => {
                  setTab({ index, current });
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, index);
                }}
              >
                {row.label}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
