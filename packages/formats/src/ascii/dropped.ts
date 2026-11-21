import type { ViolationPath } from '@reprise/model';

/**
 * What an ASCII tab export leaves out. Rhythm, dynamics, accents, staccato, fingering, fades,
 * key signatures, clefs and mixer changes are absent by the format's convention and are not
 * reported; these are the things a reader of the text would expect to find and will not.
 */
export type AsciiDropCode =
  /** A drum or pitched track among several: it has no strings to print. */
  | 'track-skipped'
  /** Notes in voices 2 to 4; only voice 1 is written. */
  | 'other-voices'
  | 'grace-notes'
  | 'whammy'
  | 'tremolo-picking'
  /** A brush, an arpeggio or a pick stroke. */
  | 'stroke'
  /** Lyric lines 2 to 5; line 1 is written below the tab. */
  | 'lyrics-lines'
  /** Palm mute and let ring on one beat; palm mute is written. */
  | 'effect-clash';

const MESSAGES: Readonly<Record<AsciiDropCode, string>> = {
  'track-skipped': 'Tracks without strings (drums and pitched tracks) were left out.',
  'other-voices': 'Notes in voices 2 to 4 were left out.',
  'grace-notes': 'Grace notes were left out.',
  whammy: 'Whammy bar dips were left out.',
  'tremolo-picking': 'Tremolo picking was left out.',
  stroke: 'Brush, arpeggio and pick strokes were left out.',
  'lyrics-lines': 'Lyric lines 2 to 5 were left out.',
  'effect-clash': 'Palm mute and let ring on one beat: only palm mute is shown.',
};

/** Where a loss was first found, as indices into the score. */
export interface AsciiDropLocation {
  track: number;
  bar?: number;
  voice?: number;
  beat?: number;
}

/** One kind of loss, folded: `location` is the first place it was found, `count` how many. */
export interface AsciiDropped {
  code: AsciiDropCode;
  message: string;
  location: AsciiDropLocation;
  path: ViolationPath;
  count: number;
}

export class AsciiDropCollector {
  readonly #byCode = new Map<AsciiDropCode, AsciiDropped>();

  drop(code: AsciiDropCode, location: AsciiDropLocation): void {
    const existing = this.#byCode.get(code);
    if (existing) {
      existing.count++;
      return;
    }
    const path: ViolationPath = ['tracks', location.track];
    if (location.bar !== undefined) path.push('bars', location.bar);
    if (location.voice !== undefined) path.push('voices', location.voice);
    if (location.beat !== undefined) path.push('beats', location.beat);
    this.#byCode.set(code, { code, message: MESSAGES[code], location, path, count: 1 });
  }

  get dropped(): AsciiDropped[] {
    return [...this.#byCode.values()];
  }
}
