import { formatPath, type NativePath } from '@reprise/model';

/**
 * Score features a gpif document cannot carry, so a gp export loses them. Practice data never
 * reaches the writer; these are all things a score can hold and Guitar Pro 7's format cannot.
 */
export type GpifDropCode =
  /** `Section.color`: gpif sections have a letter and a name only. */
  | 'section-color'
  /** `channel.chorus`, `reverb`, `phaser` or `tremolo` away from their defaults. */
  | 'channel-effect'
  /** `Beat.mix` volume, pan, chorus, reverb, phaser or tremolo changes. */
  | 'mixer-change'
  /** `Track.sound`, the HQ sound tier's pack assignment. */
  | 'sound-override'
  /** Notes of one beat (or one grace beat) with different dynamics; gpif has one per beat. */
  | 'note-dynamics'
  /** A brush and an arpeggio on one beat with a length on the arpeggio; gpif has one length. */
  | 'stroke-duration'
  /** More than one of fade in, fade out and volume swell on a beat; gpif has one `Fadding`. */
  | 'fade'
  /** `effects.tapping` on a beat with no notes; gpif marks tapping on notes. */
  | 'tapping-without-notes'
  /** Guitar Pro's empty beat (`rest: false`, no notes), which gpif can only write as a rest. */
  | 'empty-beat'
  /** A bend whose points or kind gpif's origin, middle and destination cannot hold. */
  | 'bend-shape'
  /** The same for a whammy bar curve. */
  | 'whammy-shape'
  /** A trill speed other than sixteenths; gpif keeps the trill note but no speed. */
  | 'trill-speed'
  /** A trill whose alternate note falls outside MIDI on its string. */
  | 'trill-range'
  /** A chord diagram's barres that its fingering does not imply, or fingers on muted strings. */
  | 'chord-barre'
  /** A volta bracket layout the first-bar-only gpif marks cannot reproduce. */
  | 'volta-bracket'
  /** `anacrusis` on a bar other than the first; gpif has one pickup flag for the score. */
  | 'anacrusis'
  /** A notation the part configuration cannot pair with the track's kind and sound, or a kind it cannot tell. */
  | 'notation'
  /** A capo on a drum or pitched track, which a reader resets. */
  | 'capo'
  /** A tempo ramp gpif's linear automations cannot express (overlapping or past the end). */
  | 'tempo-ramp'
  /** Two different tempo marks at one moment; the one playback uses is kept. */
  | 'tempo-collision'
  /** A notice that is empty or holds a line break, which gpif's one notices block flattens. */
  | 'notices'
  /** Characters XML cannot represent (C0 controls, lone surrogates), removed from text. */
  | 'text-characters';

/**
 * One kind of loss, folded: `path` is the first model node it was found on, from the score root
 * (`score.tracks[0].bars[2].voices[0].beats[1]`), and `count` how many nodes lost it.
 */
export interface GpifDropped {
  code: GpifDropCode;
  message: string;
  path: string;
  count: number;
}

export class DropCollector {
  readonly #byCode = new Map<GpifDropCode, GpifDropped>();

  drop(code: GpifDropCode, path: NativePath, message: string): void {
    const existing = this.#byCode.get(code);
    if (existing) {
      existing.count++;
      return;
    }
    this.#byCode.set(code, { code, message, path: formatPath(['score', ...path]), count: 1 });
  }

  get dropped(): GpifDropped[] {
    return [...this.#byCode.values()];
  }
}
