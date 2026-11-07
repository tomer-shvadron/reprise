import type { Note } from './note';
import { midiNote } from './pitch';
import type { Track } from './track';

const HIGHEST_OVERTONE = 8;
/** How far a written harmonic fret may sit from a node, in frets: 3 for 3.16, 9 for 8.84. */
const NODE_TOLERANCE = 0.35;

interface Node {
  fret: number;
  interval: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Touching the string at k/n of its length leaves overtone n: 12·log2(n) above the open string. */
const NODES: readonly Node[] = (() => {
  const nodes: Node[] = [];
  for (let n = 2; n <= HIGHEST_OVERTONE; n += 1) {
    for (let k = 1; k < n; k += 1) {
      if (gcd(k, n) !== 1) continue;
      nodes.push({ fret: -12 * Math.log2(1 - k / n), interval: 12 * Math.log2(n) });
    }
  }
  return nodes;
})();

/**
 * Semitones a harmonic at fret position `fret` sounds above the string it divides: 12 at fret
 * 12, 19.02 at 7 and 19, 24 at 5 and 24, 27.86 at 4, 9 and 16, 31.02 at 3.2. Undefined off any
 * node. The interval is the pure overtone, not its tempered neighbour.
 */
export function harmonicInterval(fret: number): number | undefined {
  let best: Node | undefined;
  for (const node of NODES) {
    const distance = Math.abs(node.fret - fret);
    if (distance <= NODE_TOLERANCE && (!best || distance < Math.abs(best.fret - fret))) {
      best = node;
    }
  }
  return best?.interval;
}

type PitchTrack = Pick<Track, 'kind' | 'tuning' | 'capo'>;

/**
 * The pitch a note sounds at, as a fractional MIDI note: `midiNote`, except for a harmonic on a
 * fretted track. A natural harmonic sounds its node's overtone of the open string, capo included
 * (`value` is the node, else the fret; a fret on no node sounds as fretted); every other kind
 * sounds the fretted note raised by the overtone of the node `value` frets above it, 12 when
 * absent or on no node. Overtones are pure, so round the result for a key or a staff position.
 */
export function soundingPitch(
  track: PitchTrack,
  note: Pick<Note, 'string' | 'fret' | 'harmonic'>,
): number {
  const fretted = midiNote(track, note);
  const { harmonic } = note;
  if (!harmonic || track.kind !== 'fretted') return fretted;
  if (harmonic.kind === 'natural') {
    const interval = harmonicInterval(harmonic.value ?? note.fret);
    return interval === undefined ? fretted : fretted - note.fret + interval;
  }
  return fretted + (harmonicInterval(harmonic.value ?? 12) ?? 12);
}
