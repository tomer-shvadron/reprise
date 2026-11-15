import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from 'cn';

import { Button } from '@/components/ui/button';

import type { LibraryEntry } from './search';
import { relativeDate } from './relative-date';

export const ROW_HEIGHT = 36;
const OVERSCAN = 6;
// jsdom measures nothing; a real window is never shorter than this in practice.
const FALLBACK_HEIGHT = 600;

interface SongListProps {
  entries: readonly LibraryEntry[];
  now: number;
  onOpen: (id: string) => void;
  /** Asked for by the Delete key or a row's button; the caller confirms. */
  onDelete: (id: string) => void;
}

const COLUMNS =
  'grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_4rem_8rem_4rem] gap-3 px-3';

/**
 * A listbox of fixed-height rows that mounts only the rows in view, so render cost does not grow
 * with the library. Focus stays on the listbox and `aria-activedescendant` names the active row,
 * so the active row may scroll out of the window without losing focus.
 */
export function SongList({ entries, now, onOpen, onDelete }: SongListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);
  const [active, setActive] = useState(0);
  const last = entries.length - 1;
  const current = Math.min(active, Math.max(last, 0));

  // The row under the highlight is whichever song sits at that index, so a new list (a keystroke
  // in the search box, a sort) starts again from the top.
  const [seen, setSeen] = useState(entries);
  if (seen !== entries) {
    setSeen(entries);
    setActive(0);
    setScrollTop(0);
  }
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [entries]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      setHeight(element.clientHeight || FALLBACK_HEIGHT);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const reveal = (index: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + height) {
      element.scrollTop = top + ROW_HEIGHT - height;
    }
  };

  const move = (index: number) => {
    const next = Math.max(0, Math.min(last, index));
    setActive(next);
    reveal(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    const remove = () => {
      const entry = entries[current];
      if (entry) onDelete(entry.row.id);
    };
    const handlers: Record<string, () => void> = {
      ArrowDown: () => {
        move(current + 1);
      },
      ArrowUp: () => {
        move(current - 1);
      },
      Home: () => {
        move(0);
      },
      End: () => {
        move(last);
      },
      PageDown: () => {
        move(current + page);
      },
      PageUp: () => {
        move(current - page);
      },
      Enter: () => {
        const entry = entries[current];
        if (entry) onOpen(entry.row.id);
      },
      Delete: remove,
      // The key labelled delete on a Mac keyboard sends Backspace.
      Backspace: remove,
    };
    const handler = handlers[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(entries.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  // The active row is always mounted, even scrolled out of the window, so `aria-activedescendant`
  // never names an element that does not exist (End and PageDown set the scroll before the
  // scroll event reaches the state).
  const visible = entries
    .slice(first, end)
    .map((entry, offset) => ({ entry, index: first + offset }));
  const activeEntry = entries[current];
  if (activeEntry && (current < first || current >= end)) {
    visible.push({ entry: activeEntry, index: current });
  }
  const activeId = entries[current] ? `song-${entries[current].row.id}` : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-hidden
        className={cn(COLUMNS, 'text-muted-foreground border-b py-1.5 text-xs font-medium')}
      >
        <span>Title</span>
        <span>Artist</span>
        <span>Album</span>
        <span>Format</span>
        <span>Last opened</span>
        <span />
      </div>
      <div
        ref={scroller}
        role="listbox"
        aria-label="Songs"
        tabIndex={0}
        aria-activedescendant={activeId}
        className="focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-3"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div style={{ height: entries.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map(({ entry, index }) => {
            const { row } = entry;
            return (
              <div
                key={row.id}
                id={`song-${row.id}`}
                role="option"
                aria-selected={index === current}
                aria-setsize={entries.length}
                aria-posinset={index + 1}
                className={cn(
                  COLUMNS,
                  'absolute inset-x-0 cursor-default items-center text-sm',
                  index === current && 'bg-accent text-accent-foreground',
                )}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => {
                  setActive(index);
                }}
                onDoubleClick={() => {
                  onOpen(row.id);
                }}
              >
                <span className="truncate font-medium">{row.title}</span>
                <span className="text-muted-foreground truncate">{row.artist}</span>
                <span className="text-muted-foreground truncate">{row.album}</span>
                <span className="text-muted-foreground text-xs uppercase">{row.sourceFormat}</span>
                <span className="text-muted-foreground truncate">
                  {relativeDate(row.lastOpenedAt, now)}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  tabIndex={-1}
                  aria-label={`Delete ${row.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(row.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  Delete
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
