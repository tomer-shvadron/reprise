import { LYRIC_LINES, type Id } from '@reprise/model';

import type { AppServices } from '@/app/services';

import { commitEdit, landingCursor } from './commit';
import { entryController } from './entry-controller';
import { nextWordBeat, firstWordBeat } from './word-nav';
import { beatWithTrack, planWord, wordValue, type WordKind } from './words';

export type WordServices = Pick<AppServices, 'document' | 'selection' | 'entry' | 'editing'>;

const LAST_LINE = LYRIC_LINES - 1;

const refusals: Record<WordKind, string> = {
  chord: 'Move onto a beat to name its chord',
  text: 'Move onto a beat to add text',
  lyric: 'There is no played beat ahead to put a syllable on',
};

/** Puts the edit cursor on `beatId`, so the caret, the scroll and the beat the field edits stay one thing. */
function moveCursorTo(services: WordServices, beatId: Id): void {
  const { document, selection } = services;
  const { score } = document.getState();
  const base = selection.getState().cursor;
  if (!score || !base || base.beat === beatId) return;
  const cursor = landingCursor(score, { beat: beatId }, base);
  if (cursor) selection.getState().setEdit({ cursor, currentTrack: cursor.track });
}

function show(services: WordServices, kind: WordKind, beatId: Id, line: number): boolean {
  const { document, entry } = services;
  const { score } = document.getState();
  const found = score && beatWithTrack(score, beatId);
  if (!found) return false;
  if (kind === 'lyric') entry.getState().setLastLyricLine(line);
  entry.getState().setWord({
    kind,
    trackId: found.track.id,
    beatId,
    line,
    draft: wordValue(found.beat, kind, line),
  });
  return true;
}

/** Puts focus back on the score region, so the keys keep working after the field is gone. */
export function focusScore(): void {
  globalThis.document.querySelector<HTMLElement>('.score-view')?.focus();
}

/** Closes the field without committing. */
export function closeWord(services: Pick<WordServices, 'entry'>): void {
  services.entry.getState().setWord(undefined);
}

/**
 * Commits what is typed as one undo step, labelled for the word, leaving the cursor where it is.
 * An unchanged word writes nothing. A refusal keeps the field open with the reason on the status
 * line. Returns whether the field may move on.
 */
export function commitWord(services: WordServices): boolean {
  const { document, selection, entry } = services;
  const word = entry.getState().word;
  const { score } = document.getState();
  if (!word || !score) return true;
  const plan = planWord(score, {
    kind: word.kind,
    beatId: word.beatId,
    line: word.line,
    value: word.draft,
  });
  if ('nothing' in plan) return true;
  if ('refused' in plan) {
    entry.getState().setMessage(plan.refused);
    return false;
  }
  if (!commitEdit({ document, selection, entry }, plan.command, { moveCursor: false }))
    return false;
  if (plan.notice) entry.getState().setMessage(plan.notice, 'notice');
  return true;
}

/**
 * Opens the field on the cursor's beat: a chord name or beat text there, or for lyrics the played
 * beat of voice 1 at its onset or the next one, on `line` (the line last used by default). A
 * field already open commits first. Returns false, with the reason on the status line, when
 * nothing can take the word.
 */
export function openWord(services: WordServices, kind: WordKind, line?: number): boolean {
  const { document, selection, entry, editing } = services;
  if (!editing.getState().editing) return false;
  entryController(entry)?.flush();
  if (!commitWord(services)) return false;
  const { score } = document.getState();
  const cursor = selection.getState().cursor;
  if (!score || !cursor) return false;
  const beatId = firstWordBeat(score, cursor, kind);
  if (!beatId) {
    entry.getState().setMessage(refusals[kind]);
    return false;
  }
  const opened = show(
    services,
    kind,
    beatId,
    kind === 'lyric' ? (line ?? entry.getState().lastLyricLine) : 0,
  );
  if (opened) moveCursorTo(services, beatId);
  return opened;
}

/**
 * Commits, then moves the field to the next (1) or previous (-1) beat that takes this word. At
 * either end of the track the field closes, which says there is no more room. Returns false when
 * the commit was refused.
 */
export function stepWord(
  services: WordServices,
  direction: 1 | -1,
  /** False keeps the field open at either end of the track, where there is nowhere to go. */
  closeAtEnd = true,
): boolean {
  const { document, entry } = services;
  if (!commitWord(services)) return false;
  const word = entry.getState().word;
  const { score } = document.getState();
  if (!word || !score) return true;
  const next = nextWordBeat(score, word.beatId, word.kind, direction);
  if (!next) {
    if (closeAtEnd) {
      closeWord(services);
      focusScore();
    }
    return true;
  }
  // A notice from the commit (a removed diagram) survives the cursor move that clears messages.
  const { message, tone } = entry.getState();
  show(services, word.kind, next, word.line);
  moveCursorTo(services, next);
  if (message !== undefined && tone === 'notice') entry.getState().setMessage(message, tone);
  return true;
}

/** Commits, then moves the lyrics field `delta` lines down (1) or up (-1), staying on the beat. */
export function switchLyricLine(services: WordServices, delta: 1 | -1): boolean {
  const { entry } = services;
  const word = entry.getState().word;
  if (word?.kind !== 'lyric') return true;
  const line = Math.min(Math.max(word.line + delta, 0), LAST_LINE);
  if (line === word.line) return true;
  if (!commitWord(services)) return false;
  return show(services, 'lyric', word.beatId, line);
}

/** Commits and closes. Returns false when the commit was refused and the field stays. */
export function finishWord(services: WordServices): boolean {
  if (!commitWord(services)) return false;
  closeWord(services);
  return true;
}

/** The label the status line gives the open field. */
export function wordLabel(word: { kind: WordKind; line: number }): string {
  if (word.kind === 'chord') return 'Chord name';
  if (word.kind === 'text') return 'Text';
  return `Lyrics, line ${String(word.line + 1)}`;
}
