import type { Id, Score } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { scoreIndex } from '@/features/score';
import type { MenuTarget } from '@/state/menu-target';
import type { EditCursor, EditRange } from '@/state/selection';

import { openMasterBarDialog } from './bar-actions';
import { cursorAtPosition, defaultStaff, firstStop } from './cursor';
import { rangePatch } from './range';
import { visibleTracks, wantedNotation } from './visible';
import { openWord } from './word-session';
import { beatWithTrack } from './words';

export type EditHereServices = Pick<
  AppServices,
  'document' | 'selection' | 'entry' | 'editing' | 'menuTarget'
>;

type CursorServices = Pick<AppServices, 'document' | 'selection'>;

function trackIndex(score: Score, services: CursorServices, wanted?: Id): number {
  const id = wanted ?? services.selection.getState().currentTrack ?? score.tracks[0]?.id;
  return Math.max(
    0,
    score.tracks.findIndex((track) => track.id === id),
  );
}

function stringsOf(services: CursorServices, track: number, score: Score) {
  const { view } = services.document.getState();
  return { staff: defaultStaff(score, track, wantedNotation(score, view, track)) };
}

/** The cursor a beat-level target stands for: the beat's stop, on the note's string when it is a note. */
function beatCursor(services: CursorServices, score: Score, target: MenuTarget) {
  if (target.kind !== 'note' && target.kind !== 'beat' && target.kind !== 'chord') return undefined;
  const index = scoreIndex(score);
  const beat = index.beats.get(target.beat);
  if (!beat) return undefined;
  const string = (target.kind === 'note' && index.noteString.get(target.note)) || 1;
  // On a drum or keyboard note the cursor takes the note's key as its lane.
  const found = target.kind === 'note' ? beatWithTrack(score, target.beat) : undefined;
  const pitch =
    found && found.track.kind !== 'fretted'
      ? found.beat.notes.find((n) => target.kind === 'note' && n.id === target.note)?.fret
      : undefined;
  return cursorAtPosition(
    score,
    { track: beat.trackIndex, bar: beat.masterBarIndex, voice: beat.voice, stop: beat.index },
    {
      string,
      ...(pitch !== undefined && { pitch }),
      ...stringsOf(services, beat.trackIndex, score),
    },
  );
}

/** The cursor at a bar's first stop on a track, for a bar, a marker and a bar range. */
function barCursor(
  services: CursorServices,
  score: Score,
  bar: Id,
  track?: Id,
): EditCursor | undefined {
  const at = scoreIndex(score).barIndex.get(bar);
  if (at === undefined) return undefined;
  const t = trackIndex(score, services, track);
  return firstStop(score, t, at, 0, { string: 1, ...stringsOf(services, t, score) });
}

/**
 * The cursor a right-clicked mark or bar stands for, as "Edit here" puts it: on the chord name's
 * beat, or on the first stop of the marker's bar. Other targets have none.
 */
export function markCursor(
  services: CursorServices,
  score: Score,
  target: MenuTarget,
): EditCursor | undefined {
  if (target.kind === 'chord') return beatCursor(services, score, target);
  return target.kind === 'section' ? barCursor(services, score, target.masterBar) : undefined;
}

/**
 * Switches to edit mode and puts the cursor where the right-click was, as a plain click in edit
 * mode would, but without its seek: the playhead stays. A chord name opens its field and a
 * section marker its dialog. Without a menu target the selected bars are adopted, and a bar range
 * becomes the range. A command from the palette or the menu: it reads the target before it
 * changes anything, as the host clears it after the call returns.
 */
export function editHere(services: EditHereServices): void {
  const { score } = services.document.getState();
  if (!score || services.editing.getState().editing) return;
  const target = services.menuTarget.getState().target;
  const bars = services.selection.getState().bars;
  services.editing.getState().setEditing(true);

  let cursor: EditCursor | undefined;
  let range: EditRange | undefined;
  if (target) cursor = beatCursor(services, score, target);
  if (!cursor && (target?.kind === 'bar' || target?.kind === 'section')) {
    cursor = barCursor(
      services,
      score,
      target.masterBar,
      target.kind === 'bar' ? target.track : undefined,
    );
  }
  if (!cursor && bars) {
    cursor = barCursor(services, score, bars.startBar);
    if (cursor && bars.startBar !== bars.endBar) {
      // A bar range stays a range, over every track the view shows.
      const tracks = visibleTracks(score, services.document.getState().view);
      const first = tracks[0] ?? cursor.track;
      const last = tracks.at(-1) ?? cursor.track;
      range = {
        kind: 'bars',
        anchor: { track: first, masterBar: bars.startBar, beat: undefined },
        focus: { track: last, masterBar: bars.endBar, beat: undefined },
      };
    }
  }
  if (!cursor) return;
  services.selection.getState().setEdit({
    cursor,
    currentTrack: cursor.track,
    selection: {},
    ...rangePatch(score, range),
  });
  if (target?.kind === 'chord') openWord(services, 'chord');
  else if (target?.kind === 'section') openMasterBarDialog(services, 'section');
}
