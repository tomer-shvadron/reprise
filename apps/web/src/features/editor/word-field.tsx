import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { scoreIndex } from '@/features/score';

import { suggestChords } from './chord-suggestions';
import { MODIFIER_KEYS } from './entry-controller';
import { wordFieldRect } from './geometry';
import {
  closeWord,
  commitWord,
  finishWord,
  focusScore,
  stepWord,
  switchLyricLine,
  wordLabel,
} from './word-session';
import { beatWithTrack, wordValue } from './words';

const stop = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

const LIST_ID = 'word-suggestions';

/** Cmd or Ctrl with these keys act on the field's own text and history. */
const FIELD_KEYS = new Set(['z', 'y', 'a', 'c', 'x', 'v']);

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
  // The draft whose suggestion list Escape closed; typing shows it again.
  const [dismissed, setDismissed] = useState<string>();

  // Gone when edit mode ends or the beat does (an undo, another document).
  useEffect(() => {
    if (!word) return;
    if (!isEditing || !score || !scoreIndex(score).beats.has(word.beatId)) {
      closeWord(services);
      if (isEditing) focusScore();
    }
  }, [word, isEditing, score, services]);

  // Something other than the field changed the word on this beat (it should not, today): show it
  // rather than let the stale draft revert it on the next commit. Edits the user typed are kept.
  const seen = useRef<{ where: string; value: string }>(undefined);
  useEffect(() => {
    const open = entry.getState().word;
    const beat = open && score && beatWithTrack(score, open.beatId)?.beat;
    if (!open || !beat) {
      seen.current = undefined;
      return;
    }
    const key = `${open.kind}:${open.beatId}:${String(open.line)}`;
    const value = wordValue(beat, open.kind, open.line);
    const before = seen.current;
    seen.current = { where: key, value };
    if (before?.where === key && before.value !== value && open.draft === before.value) {
      entry.getState().setWord({ ...open, draft: value });
    }
  }, [score, word?.beatId, word?.kind, word?.line, entry]);

  const opened = word !== undefined && isEditing;
  const where = word && `${word.kind}:${word.beatId}:${String(word.line)}`;
  // Focus on open, and the whole word selected whenever the field moves, so typing replaces it.
  useLayoutEffect(() => {
    if (!opened) return;
    input.current?.focus();
    input.current?.select();
  }, [opened, where]);

  // A highlight belongs to the draft it was chosen on: typing clears it, so Enter writes what was typed.
  const pickKey = word && `${where ?? ''}|${word.draft}`;
  const active = picked.where === pickKey ? picked.index : -1;
  const hidden = dismissed === pickKey;
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
    return wordFieldRect(result, { kind, trackId, beatId, line });
  }, [result, kind, trackId, beatId, line]);
  if (!word || !isEditing || !rect) return null;

  const lyric = word.kind === 'lyric';
  // The commit reads the draft from the store, so a pick is written there first.
  const write = (value: string, then: () => void) => {
    entry.getState().setWord({ ...word, draft: value });
    then();
  };
  const toScore = focusScore;
  const handled = (event: KeyboardEvent, run: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    // A modifier pressed on its own is not a command: its keydown carries the flag of the key itself.
    if (MODIFIER_KEYS.has(event.key)) return;
    if (event.metaKey || event.ctrlKey) {
      // A shortcut leaves the field for the app (save, edit mode off), so the word goes in first.
      // These keys edit the field's own text.
      if (!FIELD_KEYS.has(event.key.toLowerCase())) commitWord(services);
      return;
    }
    if (event.altKey) return;
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
          // The combobox pattern: the first Escape closes the list, the second drops the draft.
          if (suggestions.length > 0 && !hidden) {
            setDismissed(pickKey);
            setPicked({ where: undefined, index: -1 });
            return;
          }
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
              where: pickKey,
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
        handled(event, () => stepWord(services, -1, false));
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
        aria-expanded={chord ? suggestions.length > 0 && !hidden : undefined}
        aria-controls={chord && suggestions.length > 0 && !hidden ? LIST_ID : undefined}
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
          // Not when the whole window lost focus (Cmd+Tab to a lyrics sheet): the field stays, and
          // the browser refocuses it on return. A click on the History panel does blur first and so
          // commits before its jump runs; the editor README says so.
          if (!globalThis.document.hasFocus()) return;
          if (entry.getState().word && commitWord(services)) closeWord(services);
        }}
      />
      {suggestions.length > 0 && !hidden && (
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
