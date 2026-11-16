import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { scoreIndex } from '@/features/score';

import { suggestChords } from './chord-suggestions';
import { wordFieldRect } from './geometry';
import {
  closeWord,
  commitWord,
  finishWord,
  stepWord,
  switchLyricLine,
  wordLabel,
} from './word-session';
import { beatWithTrack, wordValue } from './words';

const stop = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

const LIST_ID = 'word-suggestions';

/**
 * The inline field of WP-085, over the score at the beat it edits: a chord name, beat text or a
 * lyric line. It lives inside the score's zoomed canvas, so layout coordinates are its own and
 * scrolling and zoom carry it. Its keys are its own (they stop at the field, so no editor
 * shortcut sees them); Ctrl and Cmd shortcuts still reach the window.
 */
export function WordField() {
  const services = useAppServices();
  const { document, entry, editing, layout, ui } = services;
  const word = useStore(entry, (state) => state.word);
  const isEditing = useStore(editing, (state) => state.editing);
  const score = useStore(document, (state) => state.score);
  const result = useStore(layout, (state) => state.result);
  const zoom = useStore(ui, (state) => state.zoom);
  const input = useRef<HTMLInputElement>(null);
  // The highlighted suggestion, valid for the draft it was chosen on.
  const [picked, setPicked] = useState<{ where: string | undefined; index: number }>({
    where: undefined,
    index: -1,
  });

  // Gone when edit mode ends or the beat does (an undo, another document).
  useEffect(() => {
    if (!word) return;
    if (!isEditing || !score || !scoreIndex(score).beats.has(word.beatId)) closeWord(services);
  }, [word, isEditing, score, services]);

  const opened = word !== undefined && isEditing;
  const where = word && `${word.kind}:${word.beatId}:${String(word.line)}`;
  // Focus on open, and the whole word selected whenever the field moves, so typing replaces it.
  useLayoutEffect(() => {
    if (!opened) return;
    input.current?.focus();
    input.current?.select();
  }, [opened, where]);

  const active = picked.where === where ? picked.index : -1;
  const kind = word?.kind;
  const draft = word?.draft ?? '';
  const suggestions = useMemo(
    () => (score && kind === 'chord' ? suggestChords(score, draft).slice(0, 8) : []),
    [score, kind, draft],
  );
  const trackId = word?.trackId;
  const beatId = word?.beatId;
  const line = word?.line ?? 0;
  const rect = useMemo(() => {
    if (!result || !kind || !trackId || !beatId) return undefined;
    const beat = score && beatWithTrack(score, beatId)?.beat;
    return wordFieldRect(
      result,
      { kind, trackId, beatId, line },
      beat ? wordValue(beat, kind, line) : '',
    );
  }, [result, score, kind, trackId, beatId, line]);
  if (!word || !isEditing || !rect) return null;

  const lyric = word.kind === 'lyric';
  // The commit reads the draft from the store, so a pick is written there first.
  const write = (value: string, then: () => void) => {
    entry.getState().setWord({ ...word, draft: value });
    then();
  };
  const toScore = () => {
    (input.current?.closest('.score-view') as HTMLElement | null)?.focus();
  };
  const handled = (event: KeyboardEvent, run: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { key, shiftKey } = event;
    const pick = suggestions[active];
    const step = (direction: 1 | -1) => () => stepWord(services, direction);
    switch (key) {
      case 'Tab':
        handled(event, () => {
          write(pick ?? word.draft, step(shiftKey ? -1 : 1));
        });
        return;
      case 'Enter':
        handled(event, () => {
          write(pick ?? word.draft, () => {
            if (finishWord(services)) toScore();
          });
        });
        return;
      case 'Escape':
        handled(event, () => {
          closeWord(services);
          toScore();
        });
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        handled(event, () => {
          const down = key === 'ArrowDown';
          if (lyric) switchLyricLine(services, down ? 1 : -1);
          else
            setPicked({
              where,
              index: Math.min(Math.max(active + (down ? 1 : -1), -1), suggestions.length - 1),
            });
        });
        return;
      case ' ':
        // Shift+Space types a space inside a syllable, the way Guitar Pro's `+` does.
        if (!lyric || shiftKey) return;
        handled(event, step(1));
        return;
      case '-':
        if (!lyric) return;
        handled(event, () => {
          // A hyphen alone would be a syllable of nothing.
          const syllable = word.draft.trim().replace(/-$/, '');
          if (syllable !== '') write(`${syllable}-`, step(1));
        });
        return;
      case 'Backspace':
        if (!lyric || word.draft !== '') return;
        handled(event, step(-1));
        return;
      default:
    }
  };

  const at = score && beatPosition(score, word.beatId);
  const label = `${wordLabel(word).replace(', ', ' ')}${at ?? ''}`;
  const chord = word.kind === 'chord';
  return (
    <div
      className="absolute top-0 left-0 z-10"
      style={{
        transform: `translate(${String(rect.x * zoom)}px, ${String(rect.y * zoom)}px)${rect.align === 'middle' ? ' translateX(-50%)' : ''}`,
      }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
    >
      <input
        ref={input}
        type="text"
        role={chord ? 'combobox' : undefined}
        aria-label={label}
        aria-expanded={chord ? suggestions.length > 0 : undefined}
        aria-controls={chord && suggestions.length > 0 ? LIST_ID : undefined}
        aria-activedescendant={
          active >= 0 && suggestions[active] ? `${LIST_ID}-${String(active)}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        value={word.draft}
        className="bg-paper text-ink border-ring rounded-sm border px-1 outline-none"
        style={{
          height: rect.height * zoom,
          fontSize: rect.size * zoom,
          minWidth: rect.size * 6 * zoom,
          width: `${String(Math.max(6, word.draft.length + 2))}ch`,
          textAlign: rect.align === 'middle' ? 'center' : 'left',
        }}
        onChange={(event) => {
          entry.getState().setWord({ ...word, draft: event.target.value });
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Reads the store, so a field a key already closed is gone and does nothing here.
          if (entry.getState().word && commitWord(services)) closeWord(services);
        }}
      />
      {suggestions.length > 0 && (
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label="Chord names in this song"
          className="bg-paper text-ink absolute left-0 mt-0.5 min-w-full rounded-sm border text-sm shadow-md"
        >
          {suggestions.map((name, index) => (
            <li
              key={name}
              id={`${LIST_ID}-${String(index)}`}
              role="option"
              aria-selected={index === active}
              className="aria-selected:bg-muted cursor-pointer px-2 py-0.5"
              // Keeps the field focused, so the click does not blur and commit first.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                write(name, () => stepWord(services, 1));
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ", bar 3 beat 2" for the field's accessible name. */
function beatPosition(score: Parameters<typeof scoreIndex>[0], beatId: string): string | undefined {
  const info = scoreIndex(score).beats.get(beatId);
  return info && `, bar ${String(info.masterBarIndex + 1)} beat ${String(info.index + 1)}`;
}
