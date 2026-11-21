import type { ChordDiagram, Track } from '@reprise/model';

import { fingerShape } from './fingering';
import { modulo, type PitchClass } from './names';
import { parseChord, type ChordSpec } from './qualities';

export type VoicingTrack = Pick<Track, 'tuning' | 'capo' | 'fretCount'> &
  Partial<Pick<Track, 'drone'>>;

export interface VoicingOptions {
  /** Frets from the lowest to the highest fretted note, both counted; open strings do not count. Default 4. */
  maxSpan?: number;
  /** Strings that must sound. Default 3. */
  minStrings?: number;
  /** Put the root (or the slash bass) in the bass; false allows any chord tone there. Default true. */
  rootInBass?: boolean;
  limit?: number;
}

export interface Voicing {
  /** Frets count from the capo and string 1 is the highest, as the model stores them. */
  /** Frozen: the entries are shared by every caller. */
  diagram: ChordDiagram;
  /** The lowest fretted fret, 0 for a shape of open strings only. */
  position: number;
  /** The pitch class of the lowest sounding string. */
  bass: PitchClass;
  /** Lower is better: tier, inner mutes, missing tones, reach, span and fingers, in that order of weight. */
  score: number;
}

const DEFAULTS = { maxSpan: 4, minStrings: 3, rootInBass: true } as const;
// An "open position" chord stays within the first three frets.
const OPEN_POSITION_LAST_FRET = 3;
const cache = new Map<string, Voicing[]>();

/**
 * Every playable shape of a chord on a track, best first. Names describe the sounding pitch, so
 * the capo is added to each string before a fret is tested. Shapes come from the chord's
 * intervals searched over the neck, so any tuning, capo and string count works.
 */
export function voicings(
  chord: ChordSpec,
  track: VoicingTrack,
  options: VoicingOptions = {},
): Voicing[] {
  const { maxSpan, minStrings, rootInBass } = { ...DEFAULTS, ...options };
  const key = JSON.stringify([
    chord.root,
    chord.quality.suffix,
    chord.bass ?? null,
    track.tuning,
    track.capo,
    track.fretCount,
    track.drone?.string ?? null,
    maxSpan,
    minStrings,
    rootInBass,
  ]);
  let all = cache.get(key);
  if (!all) {
    all = search(chord, track, maxSpan, minStrings, rootInBass).map(freeze);
    if (cache.size > 200) cache.clear();
    cache.set(key, all);
  }
  // The entries are shared and frozen; the list is the caller's own.
  return all.slice(0, options.limit);
}

/** `voicings` for a chord written as text; `[]` when the name is not a chord the table knows. */
export function voicingsForName(
  name: string,
  track: VoicingTrack,
  options?: VoicingOptions,
): Voicing[] {
  const chord = parseChord(name);
  return chord ? voicings(chord, track, options) : [];
}

function search(
  chord: ChordSpec,
  track: VoicingTrack,
  maxSpan: number,
  minStrings: number,
  rootInBass: boolean,
): Voicing[] {
  const stringCount = track.tuning.length;
  if (stringCount === 0) return [];
  const pitches = track.tuning.map((open) => open + track.capo);
  const maxFret = Math.max(0, track.fretCount - track.capo);
  const bassPc = chord.bass ?? (rootInBass ? chord.root : undefined);

  const played = chord.quality.intervals.filter((i) => !chord.quality.avoid?.includes(i));
  const tones = new Set(played.map((i) => modulo(chord.root + i, 12)));
  if (bassPc !== undefined) tones.add(bassPc);
  const required = new Set(
    chord.quality.intervals
      .filter((i) => !chord.quality.optional.includes(i))
      .map((i) => modulo(chord.root + i, 12)),
  );
  if (bassPc !== undefined) required.add(bassPc);
  const distinctNeeded = Math.min(3, chord.quality.intervals.length);

  const found = new Map<string, Voicing>();
  // Low string first while searching; the diagram is reversed at the end.
  const frets: (number | null)[] = Array.from({ length: stringCount }, () => null);

  for (let window = 0; window <= maxFret; window++) {
    const top = Math.min(window + maxSpan - 1, maxFret);
    const visit = (i: number, bassSeen: boolean): void => {
      if (i === stringCount) {
        accept();
        return;
      }
      const pitch = pitches[i] ?? 0;
      // A muted string is always an option; below the bass nothing sounds yet.
      frets[i] = null;
      visit(i + 1, bassSeen);
      // A banjo's short string stays muted: how Guitar Pro numbers its diagram frets is not known
      // (#348), and a shape needing it would not be the one a player reads off the neck.
      if (stringCount - i === track.drone?.string) return;
      const choices: number[] = [];
      if (tones.has(modulo(pitch, 12))) choices.push(0);
      for (let fret = Math.max(window, 1); window > 0 && fret <= top; fret++) {
        if (tones.has(modulo(pitch + fret, 12))) choices.push(fret);
      }
      for (const fret of choices) {
        if (!bassSeen && bassPc !== undefined && modulo(pitch + fret, 12) !== bassPc) continue;
        frets[i] = fret;
        visit(i + 1, true);
      }
      frets[i] = null;
    };

    const accept = (): void => {
      const sounding: number[] = [];
      const seen = new Set<number>();
      let lowestFret = Infinity;
      let highestFret = 0;
      frets.forEach((fret, i) => {
        if (fret === null) return;
        sounding.push(i);
        seen.add(modulo((pitches[i] ?? 0) + fret, 12));
        if (fret > 0) {
          lowestFret = Math.min(lowestFret, fret);
          highestFret = Math.max(highestFret, fret);
        }
      });
      if (sounding.length < minStrings || seen.size < distinctNeeded) return;
      for (const pc of required) if (!seen.has(pc)) return;
      // Each window owns the shapes whose lowest fretted fret is its start, so none repeats.
      if (window === 0 ? lowestFret !== Infinity : lowestFret !== window) return;

      const first = sounding[0] ?? 0;
      const last = sounding[sounding.length - 1] ?? 0;
      const innerMutes = frets.slice(first, last + 1).filter((fret) => fret === null).length;
      const hand = fingerShape([...frets].reverse());
      if (!hand) return;

      const muted = stringCount - sounding.length;
      const hasOpen = frets.includes(0);
      const position = window;
      const span = window === 0 ? 0 : highestFret - lowestFret + 1;
      const fingers = new Set(hand.fingering.filter((f) => f !== null)).size;
      const missing =
        chord.quality.intervals.length -
        new Set(chord.quality.intervals.filter((i) => seen.has(modulo(chord.root + i, 12)))).size;
      const ordered = [...frets].reverse();
      // Tier 0 is a chord of the first frets with open strings, mutes only at the edges and
      // fingers that can reach; tier 1 a movable shape (no open string); tier 2 open strings
      // mixed with high frets, or a stretch no hand makes.
      const tier = !hasOpen
        ? 1
        : innerMutes === 0 && highestFret <= OPEN_POSITION_LAST_FRET && !stretches(ordered)
          ? 0
          : 2;
      // A muted string costs as much as two frets of position (nothing for a power chord, which is
      // two or three strings by nature) and every fret of span beyond two one more: without that, a six-string
      // barre at the seventh fret would beat the Bm shape at the second.
      const muteCost = chord.quality.intervals.length === 2 ? 0 : 2;
      const reach = muted * muteCost + position + Math.max(0, span - 2);
      const score =
        tier * 1e10 + innerMutes * 1e9 + missing * 1e8 + reach * 1e6 + span * 1e3 + fingers;

      const diagram: ChordDiagram = {
        baseFret: highestFret <= 4 ? 1 : Math.max(1, lowestFret),
        frets: ordered,
        ...(hand.barres.length > 0 && { barres: hand.barres }),
        fingering: hand.fingering,
      };
      found.set(ordered.map((f) => (f === null ? 'x' : String(f))).join(','), {
        diagram,
        position,
        bass: modulo((pitches[first] ?? 0) + (frets[first] ?? 0), 12),
        score,
      });
    };

    visit(0, false);
  }
  return [...found.entries()]
    .sort((a, b) => a[1].score - b[1].score || (a[0] < b[0] ? -1 : 1))
    .map(([, voicing]) => voicing);
}

/**
 * Two neighbouring notes on one fret more than two strings apart with a higher fret between them
 * need a barre or a stretch no hand makes (`102210` for F major 7), so the shape is not an
 * open-position one. `ordered` is string 1 first.
 */
function stretches(ordered: readonly (number | null)[]): boolean {
  const last = new Map<number, number>();
  for (let i = 0; i < ordered.length; i++) {
    const fret = ordered[i];
    if (fret === null || fret === undefined || fret === 0) continue;
    const before = last.get(fret);
    last.set(fret, i);
    if (before === undefined || i - before <= 2) continue;
    if (ordered.slice(before + 1, i).some((between) => between !== null && between > fret)) {
      return true;
    }
  }
  return false;
}

function freeze(voicing: Voicing): Voicing {
  const { diagram } = voicing;
  Object.freeze(diagram.frets);
  if (diagram.barres) {
    diagram.barres.forEach((barre) => Object.freeze(barre));
    Object.freeze(diagram.barres);
  }
  if (diagram.fingering) Object.freeze(diagram.fingering);
  Object.freeze(diagram);
  return Object.freeze(voicing);
}
