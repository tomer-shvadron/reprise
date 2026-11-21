import type { Barre, Finger } from '@reprise/model';

/** A shape's frets, string 1 (the highest) first; `null` is muted, 0 open. */
export type ShapeFrets = readonly (number | null)[];

export interface Fingering {
  /** Parallel to the frets; `null` where no finger is shown. */
  fingering: (Finger | null)[];
  barres: Barre[];
}

// The thumb is never used: a shape that needs five fingers is rejected.
const FINGERS: readonly Finger[] = ['index', 'middle', 'ring', 'little'];

interface Fretted {
  /** 0-based position in `frets`. */
  at: number;
  fret: number;
}

/**
 * The fingers and barres of a shape, or `undefined` when four fingers cannot play it.
 *
 * A barre goes at the lowest fretted fret, in two cases. When more than four notes are fretted it
 * is the only way, and it spans every string between the first and the last one on that fret
 * (none of them open or muted). Otherwise a small barre is drawn when two or more strings next to
 * each other share the lowest fret and the run reaches the highest sounding string, as in the
 * small F `xx3211` or `x3333x`; a D shape (`xx0232`, a higher fret between its two fret-2 notes)
 * or an A shape (open high string) keeps a finger per note. The other notes take the remaining
 * fingers by fret, then bass string first.
 */
export function fingerShape(frets: ShapeFrets): Fingering | undefined {
  const fretted: Fretted[] = [];
  frets.forEach((fret, at) => {
    if (fret !== null && fret > 0) fretted.push({ at, fret });
  });
  const fingering: (Finger | null)[] = frets.map(() => null);
  if (fretted.length === 0) return { fingering, barres: [] };

  const lowest = Math.min(...fretted.map((note) => note.fret));
  const needed = fretted.length > FINGERS.length;
  const barre = needed ? barreAt(frets, lowest) : smallBarreAt(frets, lowest);
  if (needed && !barre) return undefined;

  const covered = (note: Fretted): boolean =>
    barre !== undefined &&
    note.fret === lowest &&
    note.at >= barre.firstString - 1 &&
    note.at <= barre.lastString - 1;
  const rest = fretted.filter((note) => !covered(note));
  if (barre) for (const note of fretted) if (covered(note)) fingering[note.at] = 'index';
  // Bass strings (the higher index) take the lower finger on a shared fret.
  rest.sort((a, b) => a.fret - b.fret || b.at - a.at);
  const free = barre ? FINGERS.slice(1) : FINGERS;
  if (rest.length > free.length) return undefined;
  rest.forEach((note, i) => {
    fingering[note.at] = free[i] ?? null;
  });
  return { fingering, barres: barre ? [barre] : [] };
}

/** A run of adjacent strings at `fret` that starts on the highest sounding string. */
function smallBarreAt(frets: ShapeFrets, fret: number): Barre | undefined {
  const first = frets.findIndex((value) => value !== null);
  if (first < 0 || frets[first] !== fret) return undefined;
  let last = first;
  while (frets[last + 1] === fret) last++;
  return last > first ? { fret, firstString: first + 1, lastString: last + 1 } : undefined;
}

function barreAt(frets: ShapeFrets, fret: number): Barre | undefined {
  const strings: number[] = [];
  frets.forEach((value, at) => {
    if (value === fret) strings.push(at);
  });
  const first = strings[0];
  const last = strings[strings.length - 1];
  if (first === undefined || last === undefined || first === last) return undefined;
  for (let at = first; at <= last; at++) {
    const value = frets[at];
    if (value === null || value === undefined || value < fret) return undefined;
  }
  return { fret, firstString: first + 1, lastString: last + 1 };
}
