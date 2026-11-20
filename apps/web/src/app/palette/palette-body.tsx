import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { Command, CommandInput, CommandList } from '@/components/ui/command';
import { InputGroupAddon } from '@/components/ui/input-group';
import type { PaletteMode } from '@/state/ui';

import type { CommandRegistry } from '../command-registry';
import { formatShortcut, matchesShortcut, type KeyboardPlatform } from '../keyboard';
import type { AppServices } from '../services';
import {
  BarRows,
  CommandRows,
  rank,
  SectionRows,
  SongRows,
  TrackRows,
  type ModeReport,
} from './mode-rows';
import { parseQuery } from './query';

const START_TEXT: Record<PaletteMode, string> = {
  commands: '',
  sections: '#',
  tracks: '@',
  songs: '/',
  bar: '',
};

const MODE_NAMES: Record<PaletteMode, string> = {
  commands: 'Commands',
  sections: 'Sections',
  tracks: 'Tracks',
  songs: 'Library',
  bar: 'Go to bar',
};

const PREFIXES: { char: string; word: string; label: string }[] = [
  { char: '>', word: 'commands', label: 'Search commands, type >' },
  { char: '#', word: 'sections', label: 'Search sections, type #' },
  { char: '@', word: 'tracks', label: 'Search tracks, type @' },
  { char: '/', word: 'songs', label: 'Search songs, type /' },
];

const ALT_KEY = { key: 'Enter', mod: true } as const;

interface PaletteBodyProps {
  services: AppServices;
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
  /** The mode the palette was opened in. The parent remounts the body when it changes. */
  start: PaletteMode | undefined;
  close: () => void;
}

/**
 * The palette's contents, mounted only while it is open, so a closed palette subscribes to no store
 * and re-renders on no edit or playhead tick. Only the active mode's rows component is mounted, so
 * only its provider runs.
 */
export function PaletteBody({ services, registry, keyboard, start, close }: PaletteBodyProps) {
  const [input, setInput] = useState(START_TEXT[start ?? 'commands']);
  const [locked, setLocked] = useState(start === 'bar');
  const [value, setValue] = useState('');
  const [report, setReport] = useState<ModeReport>({ rows: [] });
  const inputRef = useRef<HTMLInputElement>(null);

  const { mode, text } = useMemo(
    () => (locked ? { mode: 'bar' as const, text: input.trim() } : parseQuery(input)),
    [locked, input],
  );
  const total = useStore(services.document, (state) => state.score?.masterBars.length);
  const { rows, note, empty } = report;

  // Without cmdk's filter the first row is not chosen on its own when the rows change.
  const selected =
    mode === 'commands' || rows.some((row) => row.value === value) ? value : (rows[0]?.value ?? '');

  const changeInput = (next: string) => {
    if (locked) {
      if (/^[>#@/]/u.test(next.trimStart())) {
        setLocked(false);
        setInput(next);
      } else {
        setInput(next.replace(/\D/gu, ''));
      }
      return;
    }
    setInput(next);
  };

  const insertPrefix = (char: string) => {
    setLocked(false);
    setInput(char === '>' ? '>' : char);
    inputRef.current?.focus();
  };

  const selectedRow = rows.find((row) => row.value === selected);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked && event.key === 'Backspace' && input === '') {
      event.preventDefault();
      setLocked(false);
      return;
    }
    if (!matchesShortcut(event, ALT_KEY, keyboard) || selectedRow === undefined) return;
    event.preventDefault();
    close();
    (selectedRow.alt ?? selectedRow).run();
  };

  // The live region speaks when the mode or the empty message changes, not on every keystroke:
  // the sentence is rebuilt only for a new key, during render, as React allows for derived state.
  const statusKey = `${mode}|${empty ?? ''}`;
  const [spoken, setSpoken] = useState({ key: '', text: '' });
  if (spoken.key !== statusKey) {
    setSpoken({
      key: statusKey,
      text:
        empty ?? (mode === 'commands' ? '' : `${MODE_NAMES[mode]}, ${String(rows.length)} results`),
    });
  }

  const altKeys = formatShortcut(ALT_KEY, keyboard);
  const enterKey = formatShortcut({ key: 'Enter' }, keyboard);
  let hint: React.ReactNode;
  if (mode === 'commands') {
    hint =
      input.trim() === '' ? (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {PREFIXES.map(({ char, word, label }) => (
            <button
              key={char}
              type="button"
              aria-label={label}
              className="hover:text-foreground focus-visible:ring-ring rounded outline-none focus-visible:ring-2"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                insertPrefix(char);
              }}
            >
              <kbd className="font-sans">{char}</kbd> {word}
            </button>
          ))}
          <span>
            <kbd className="font-sans">12</kbd> bar
          </span>
        </span>
      ) : (
        `${enterKey} Run`
      );
  } else if (selectedRow) {
    hint = (
      <>
        {enterKey} {mode === 'tracks' ? 'Select' : mode === 'songs' ? 'Open' : 'Go to'}
        {selectedRow.alt ? ` · ${altKeys} ${selectedRow.alt.label}` : ''}
        {note ? ` · ${note}` : ''}
      </>
    );
  } else {
    hint = note ?? '';
  }

  return (
    <Command
      filter={rank}
      shouldFilter={mode === 'commands'}
      value={selected}
      onValueChange={setValue}
      onKeyDown={onKeyDown}
    >
      <CommandInput
        ref={inputRef}
        autoFocus
        value={input}
        onValueChange={changeInput}
        placeholder={locked ? `Bar number (1–${String(total ?? 0)})` : 'Type a command…'}
        aria-describedby="palette-hint"
        {...(locked && { 'aria-label': `Go to bar, 1 to ${String(total ?? 0)}` })}
        badge={
          locked && (
            <InputGroupAddon className="pr-0 pl-0">
              <span className="bg-muted text-foreground rounded px-1.5 py-0.5 text-xs">
                Go to bar
              </span>
            </InputGroupAddon>
          )
        }
      />
      <CommandList>
        {mode === 'commands' && (
          <CommandRows registry={registry} keyboard={keyboard} close={close} />
        )}
        {mode === 'sections' && (
          <SectionRows
            {...{ services, text, keyboard, close }}
            selected={selected}
            report={setReport}
          />
        )}
        {mode === 'tracks' && (
          <TrackRows
            {...{ services, text, keyboard, close }}
            selected={selected}
            report={setReport}
          />
        )}
        {mode === 'songs' && (
          <SongRows
            {...{ services, text, keyboard, close, registry }}
            selected={selected}
            report={setReport}
          />
        )}
        {mode === 'bar' && (
          <BarRows
            {...{ services, text, keyboard, close }}
            selected={selected}
            report={setReport}
          />
        )}
      </CommandList>
      <div id="palette-hint" className="text-muted-foreground border-t px-3 py-1.5 text-xs">
        {hint}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {spoken.text}
      </div>
    </Command>
  );
}

export type { ModeReport };
