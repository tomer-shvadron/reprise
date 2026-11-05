import type { Bar, Voice } from './bar';
import { DotsSchema } from './beat';
import type { Beat } from './beat';
import type { MasterBar } from './master-bar';
import type { Note } from './note';
import type { Score } from './score';
import { barTicks, beatTicks } from './ticks';
import type { Track } from './track';

export type ViolationRule =
  | 'duplicate-id'
  | 'bar-count'
  | 'track-kind'
  | 'voice-overfull'
  | 'rest-with-notes'
  | 'string-range'
  | 'duplicate-string'
  | 'tie-target'
  | 'tuplet'
  | 'dots'
  | 'chord-diagram'
  | 'alternate-ending-order'
  | 'alternate-ending-outside-repeat';

export type ViolationPath = (string | number)[];

export interface Violation {
  rule: ViolationRule;
  /** Same shape as a Zod issue path, from the score root. */
  path: ViolationPath;
  message: string;
}

// Septuplets and other odd tuplets sum to fractional ticks; this absorbs the float error only.
const TICK_EPSILON = 1e-6;

type Report = (rule: ViolationRule, path: ViolationPath, message: string) => void;

export function validateScore(score: Score): Violation[] {
  const violations: Violation[] = [];
  const report: Report = (rule, path, message) => {
    violations.push({ rule, path, message });
  };

  checkUniqueIds(score, report);
  checkAlternateEndings(score.masterBars, report);
  score.tracks.forEach((track, trackIndex) => {
    checkTrack(score, track, ['tracks', trackIndex], report);
  });
  return violations;
}

function checkUniqueIds(score: Score, report: Report): void {
  const seen = new Map<string, ViolationPath>();
  const visit = (id: string, path: ViolationPath): void => {
    const first = seen.get(id);
    if (first) {
      report('duplicate-id', [...path, 'id'], `id ${id} is already used at ${first.join('.')}`);
    } else {
      seen.set(id, path);
    }
  };
  const visitNotes = (notes: Note[], path: ViolationPath): void => {
    notes.forEach((note, n) => {
      visit(note.id, [...path, n]);
    });
  };

  visit(score.id, []);
  score.masterBars.forEach((masterBar, m) => {
    visit(masterBar.id, ['masterBars', m]);
  });
  score.tracks.forEach((track, t) => {
    visit(track.id, ['tracks', t]);
    track.bars.forEach((bar, b) => {
      const barPath = ['tracks', t, 'bars', b];
      visit(bar.id, barPath);
      bar.voices.forEach((voice, v) => {
        const voicePath = [...barPath, 'voices', v];
        visit(voice.id, voicePath);
        voice.beats.forEach((beat, i) => {
          const beatPath = [...voicePath, 'beats', i];
          visit(beat.id, beatPath);
          visitNotes(beat.notes, [...beatPath, 'notes']);
          beat.grace?.forEach((grace, g) => {
            visitNotes(grace.notes, [...beatPath, 'grace', g, 'notes']);
          });
        });
      });
    });
  });
}

/**
 * A volta needs a repeat to return from: every run of consecutive bars carrying alternate
 * endings must contain a repeat end. The final volta, after the last repeat end, stays valid.
 */
function checkAlternateEndings(masterBars: MasterBar[], report: Report): void {
  let runStart = -1;
  let runHasRepeatEnd = false;
  const closeRun = (end: number): void => {
    if (runStart >= 0 && !runHasRepeatEnd) {
      for (let m = runStart; m < end; m++) {
        report(
          'alternate-ending-outside-repeat',
          ['masterBars', m, 'alternateEndings'],
          'alternate ending is not part of a repeated section: no repeat end in its run of voltas',
        );
      }
    }
    runStart = -1;
    runHasRepeatEnd = false;
  };

  masterBars.forEach((masterBar, m) => {
    const endings = masterBar.alternateEndings;
    if (endings.some((ending, i) => i > 0 && ending <= (endings[i - 1] ?? 0))) {
      report(
        'alternate-ending-order',
        ['masterBars', m, 'alternateEndings'],
        `alternate endings must be unique and ascending, got [${endings.join(', ')}]`,
      );
    }
    if (endings.length === 0) {
      closeRun(m);
      return;
    }
    if (runStart < 0) runStart = m;
    if (masterBar.repeat.endCount > 0) runHasRepeatEnd = true;
  });
  closeRun(masterBars.length);
}

function checkTrack(score: Score, track: Track, path: ViolationPath, report: Report): void {
  if (track.bars.length !== score.masterBars.length) {
    report(
      'bar-count',
      [...path, 'bars'],
      `track has ${String(track.bars.length)} bars but the score has ${String(score.masterBars.length)} master bars`,
    );
  }
  checkTrackKind(track, path, report);

  track.bars.forEach((bar, b) => {
    const masterBar = score.masterBars[b];
    bar.voices.forEach((voice, v) => {
      const voicePath = [...path, 'bars', b, 'voices', v];
      if (masterBar) checkVoiceLength(voice, masterBar, voicePath, report);
      voice.beats.forEach((beat, i) => {
        const beatPath = [...voicePath, 'beats', i];
        checkRhythm(beat, beatPath, report);
        if (beat.rest && beat.notes.length > 0) {
          report('rest-with-notes', [...beatPath, 'notes'], 'a rest beat carries notes');
        }
        checkNotes(track, beat.notes, [...beatPath, 'notes'], report);
        beat.grace?.forEach((grace, g) => {
          checkNotes(track, grace.notes, [...beatPath, 'grace', g, 'notes'], report);
        });
        checkChordDiagram(track, beat, beatPath, report);
        checkTies(track, beat, previousBeat(track.bars, b, v, i), beatPath, report);
      });
    });
  });
}

function checkTrackKind(track: Track, path: ViolationPath, report: Report): void {
  if (track.kind === 'fretted') {
    if (track.tuning.length === 0) {
      report('track-kind', [...path, 'tuning'], 'a fretted track needs at least one string');
    }
    if (track.fretCount < 1) {
      report('track-kind', [...path, 'fretCount'], 'a fretted track needs at least one fret');
    }
    return;
  }
  // A pitched track may keep the tuning a GP5 keyboard part was written against.
  if (track.kind !== 'drums') return;
  if (track.tuning.length > 0) {
    report('track-kind', [...path, 'tuning'], 'a drums track has no strings to tune');
  }
  if (track.capo !== 0) {
    report('track-kind', [...path, 'capo'], 'a drums track has no capo');
  }
  if (track.fretCount !== 0) {
    report('track-kind', [...path, 'fretCount'], 'a drums track has no frets');
  }
}

function checkVoiceLength(
  voice: Voice,
  masterBar: MasterBar,
  path: ViolationPath,
  report: Report,
): void {
  const capacity = barTicks(masterBar.timeSignature);
  const used = voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
  if (used > capacity + TICK_EPSILON) {
    report(
      'voice-overfull',
      path,
      `voice holds ${String(used)} ticks but the bar is ${String(capacity)} ticks long`,
    );
  }
}

function checkRhythm(beat: Beat, path: ViolationPath, report: Report): void {
  if (!DotsSchema.safeParse(beat.dots).success) {
    report('dots', [...path, 'dots'], `dots must be 0, 1 or 2, got ${String(beat.dots)}`);
  }
  const { tuplet } = beat;
  if (!tuplet) return;
  const { n, of } = tuplet;
  if (n === of || of >= 2 * n || n >= 2 * of) {
    report(
      'tuplet',
      [...path, 'tuplet'],
      `tuplet ${String(n)}:${String(of)} is not a tuplet; the ratio must lie strictly between 1:2 and 2:1 and not be 1:1`,
    );
  }
}

function checkNotes(track: Track, notes: Note[], path: ViolationPath, report: Report): void {
  const strings = new Set<number>();
  notes.forEach((note, n) => {
    const stringPath = [...path, n, 'string'];
    if (track.kind !== 'fretted') {
      if (note.string !== 0) {
        report('string-range', stringPath, `notes on a ${track.kind} track use string 0`);
      }
      return;
    }
    const stringCount = track.tuning.length;
    if (note.string < 1 || note.string > stringCount) {
      report(
        'string-range',
        stringPath,
        `string ${String(note.string)} is outside 1 to ${String(stringCount)}`,
      );
    }
    if (strings.has(note.string)) {
      report('duplicate-string', stringPath, `two notes on string ${String(note.string)}`);
    }
    strings.add(note.string);
  });
}

function checkChordDiagram(track: Track, beat: Beat, path: ViolationPath, report: Report): void {
  const diagram = beat.chord?.diagram;
  const stringCount = track.tuning.length;
  if (!diagram || stringCount === 0) return;
  const diagramPath = [...path, 'chord', 'diagram'];
  if (diagram.frets.length !== stringCount) {
    report(
      'chord-diagram',
      [...diagramPath, 'frets'],
      `diagram has ${String(diagram.frets.length)} strings, the track ${String(stringCount)}`,
    );
  }
  if (diagram.fingering && diagram.fingering.length !== diagram.frets.length) {
    report('chord-diagram', [...diagramPath, 'fingering'], 'fingering and frets differ in length');
  }
  diagram.barres?.forEach((barre, i) => {
    const inRange = (s: number): boolean => s >= 1 && s <= stringCount;
    if (!inRange(barre.firstString) || !inRange(barre.lastString)) {
      report(
        'chord-diagram',
        [...diagramPath, 'barres', i],
        'barre spans a string the track lacks',
      );
    }
  });
}

function previousBeat(bars: Bar[], b: number, v: number, i: number): Beat | undefined {
  if (i > 0) return bars[b]?.voices[v]?.beats[i - 1];
  return bars[b - 1]?.voices[v]?.beats.at(-1);
}

function checkTies(
  track: Track,
  beat: Beat,
  previous: Beat | undefined,
  path: ViolationPath,
  report: Report,
): void {
  const sameSlot = (a: Note, b: Note): boolean =>
    track.kind === 'fretted' ? a.string === b.string : a.fret === b.fret;
  beat.notes.forEach((note, n) => {
    if (!note.tie) return;
    const found = previous && !previous.rest && previous.notes.some((p) => sameSlot(p, note));
    if (!found) {
      const where =
        track.kind === 'fretted'
          ? `on string ${String(note.string)}`
          : `at MIDI ${String(note.fret)}`;
      report(
        'tie-target',
        [...path, 'notes', n, 'tie'],
        `tied note has no note ${where} in the previous beat of its voice`,
      );
    }
  });
}
