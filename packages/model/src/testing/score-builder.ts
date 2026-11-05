import {
  ScoreSchema,
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  formatPath,
  newId,
  validateScore,
} from '../index';
import type {
  Beat,
  Clef,
  DirectionTarget,
  Dots,
  Duration,
  Id,
  JumpKind,
  KeySignature,
  MasterBar,
  Note,
  Score,
  ScoreMeta,
  TempoMark,
  TimeSignature,
  Track,
  TrackKind,
  TrackOptions,
  Tuplet,
  Violation,
} from '../index';

/** `'8'` an eighth, `'4.'` a dotted quarter, `'2..'` double-dotted, `'8t'` a triplet eighth. */
export type DurationSpec = `${Duration}` | `${Duration}.` | `${Duration}..` | `${Duration}t`;

/** The instrument presets `track()` offers; each maps onto a `TrackKind` with its defaults. */
export type Instrument = 'guitar' | 'bass' | 'drums' | 'piano';

export type TrackSpec = Omit<TrackOptions, 'bars' | 'barCount'> & { id?: Id };

/** Everything on a beat but its rhythm and notes, which `beat()` takes positionally. */
export type BeatSpec = Partial<Omit<Beat, 'duration' | 'dots' | 'notes' | 'rest'>>;

export type NoteSpec = Partial<Omit<Note, 'string' | 'fret'>>;

const DURATION_SPEC = /^(1|2|4|8|16|32|64|128|256)(\.{0,2}|t)$/;
const TRIPLET: Tuplet = { n: 3, of: 2 };
const BASS_TUNING = [28, 33, 38, 43];

const INSTRUMENTS: Record<Instrument, { kind: TrackKind; defaults: TrackSpec }> = {
  guitar: { kind: 'fretted', defaults: {} },
  bass: {
    kind: 'fretted',
    defaults: {
      name: 'Bass',
      shortName: 'Bs.',
      tuning: BASS_TUNING,
      program: 33,
      display: { notation: 'tab', clef: 'bass', octaveShift: 1 },
    },
  },
  drums: { kind: 'drums', defaults: {} },
  piano: { kind: 'pitched', defaults: {} },
};

export function parseDuration(spec: DurationSpec): Pick<Beat, 'duration' | 'dots' | 'tuplet'> {
  const match = DURATION_SPEC.exec(spec);
  const value = Number(match?.[1]);
  const suffix = match?.[2] ?? '';
  const duration = DURATIONS.find((d) => d === value);
  if (duration === undefined) throw new Error(`not a duration: ${spec}`);
  if (suffix === 't') return { duration, dots: 0, tuplet: { ...TRIPLET } };
  const dots = DOTS.find((d) => d === suffix.length) ?? 0;
  return { duration, dots };
}

const DURATIONS: readonly Duration[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const DOTS: readonly Dots[] = [0, 1, 2];

/** A note on a fretted track: string 1 is the highest-pitched, as in Guitar Pro. */
export function note(string: number, fret: number, spec: NoteSpec = {}): Note {
  const { id, ...rest } = spec;
  return { ...createNote({ string, fret, ...rest }), id: id ?? newId() };
}

/** A note on a drum or pitched track, where `fret` is the MIDI note and the string is 0. */
export function midi(value: number, spec: NoteSpec = {}): Note {
  return note(0, value, spec);
}

/** Thrown by `build()` with the schema issue or the invariant violations it found. */
export class ScoreBuildError extends Error {
  override readonly name = 'ScoreBuildError';
  readonly violations: readonly Violation[];

  constructor(message: string, violations: readonly Violation[] = []) {
    super(message);
    this.violations = violations;
  }
}

/**
 * A fluent score builder for tests. Score-level calls (`title`, and `tempo`, `timeSignature` and
 * `key` before any bar is open) set defaults; `track()` starts a track; `bar()` opens the next
 * bar of the current track (or of no track, for master-bar-only scores), and the first `beat()`
 * opens one if none is. Master-bar calls apply to the open bar's column, shared by every track.
 * A new master bar copies the previous one's time and key signature.
 */
export class ScoreBuilder {
  #meta: Partial<ScoreMeta> = {};
  #id: Id | undefined;
  #tempo: TempoMark = { bpm: 120 };
  #timeSignature: TimeSignature = { numerator: 4, denominator: 4 };
  #keySignature: KeySignature = { fifths: 0, minor: false };
  readonly #masterBars: MasterBar[] = [];
  readonly #tracks: Track[] = [];
  #current: Track | undefined;
  #looseBars = -1;
  #voice = 0;

  id(id: Id): this {
    this.#id = id;
    return this;
  }

  title(title: string): this {
    return this.meta({ title });
  }

  artist(artist: string): this {
    return this.meta({ artist });
  }

  meta(meta: Partial<ScoreMeta>): this {
    this.#meta = { ...this.#meta, ...meta };
    return this;
  }

  /** Before any bar: the first bar's tempo. With a bar open: a tempo change on that bar. */
  tempo(bpm: number, mark: Omit<TempoMark, 'bpm'> = {}): this {
    const tempo = { bpm, ...mark };
    if (this.#barIndex() < 0) this.#tempo = tempo;
    else this.#masterBar().tempo = tempo;
    return this;
  }

  timeSignature(numerator: number, denominator: TimeSignature['denominator']): this {
    const timeSignature = { numerator, denominator };
    if (this.#barIndex() < 0) this.#timeSignature = timeSignature;
    else this.#masterBar().timeSignature = timeSignature;
    return this;
  }

  key(fifths: number, minor = false): this {
    const keySignature = { fifths, minor };
    if (this.#barIndex() < 0) this.#keySignature = keySignature;
    else this.#masterBar().keySignature = keySignature;
    return this;
  }

  track(instrument: Instrument, spec: TrackSpec = {}): this {
    const { kind, defaults } = INSTRUMENTS[instrument];
    const { id, ...properties } = { ...defaults, ...spec };
    const track = createTrack(kind, { ...properties, barCount: 0 });
    this.#current = { ...track, id: id ?? track.id };
    this.#tracks.push(this.#current);
    this.#voice = 0;
    return this;
  }

  /** Opens the next bar; `id` names the track bar, not the master bar. */
  bar(spec: { id?: Id; clef?: Clef } = {}): this {
    this.#voice = 0;
    if (!this.#current) {
      this.#looseBars += 1;
      this.#masterBar();
      return this;
    }
    const { id, ...options } = spec;
    this.#current.bars.push({ ...createBar(options), id: id ?? newId() });
    this.#masterBar();
    return this;
  }

  /** Switches the open bar to voice `index` (0 to 3) for the beats that follow. */
  voice(index: 0 | 1 | 2 | 3): this {
    this.#voice = index;
    return this;
  }

  beat(duration: DurationSpec, notes: readonly Note[] = [], spec: BeatSpec = {}): this {
    const { id, ...rest } = spec;
    this.#beats().push({
      ...createBeat({ ...parseDuration(duration), notes: [...notes], ...rest }),
      id: id ?? newId(),
    });
    return this;
  }

  rest(duration: DurationSpec, spec: BeatSpec = {}): this {
    const { id, ...rest } = spec;
    this.#beats().push({
      ...createBeat({ ...parseDuration(duration), rest: true, ...rest }),
      id: id ?? newId(),
    });
    return this;
  }

  repeatStart(): this {
    const masterBar = this.#masterBar();
    masterBar.repeat = { ...masterBar.repeat, start: true };
    return this;
  }

  /** Closes a repeat at the open bar: `plays` is the section's total plays, 2 by default. */
  repeatEnd(plays = 2): this {
    const masterBar = this.#masterBar();
    masterBar.repeat = { ...masterBar.repeat, endCount: plays };
    return this;
  }

  volta(endings: readonly number[]): this {
    this.#masterBar().alternateEndings = [...endings];
    return this;
  }

  section(name: string, extra: Omit<NonNullable<MasterBar['section']>, 'name'> = {}): this {
    this.#masterBar().section = { name, ...extra };
    return this;
  }

  jump(kind: JumpKind): this {
    this.#masterBar().jumps.push({ kind });
    return this;
  }

  target(target: DirectionTarget): this {
    this.#masterBar().targets.push(target);
    return this;
  }

  anacrusis(): this {
    this.#masterBar().anacrusis = true;
    return this;
  }

  /** Any other master-bar field, merged into the open bar's column. */
  masterBar(changes: Partial<Omit<MasterBar, 'id'>>): this {
    Object.assign(this.#masterBar(), changes);
    return this;
  }

  /**
   * The score, every track padded with empty bars to the master-bar count, a guitar track when
   * none was declared. A builder makes one score: the result shares its nodes. Throws `ScoreBuildError` when the result fails the schema or, unless
   * `validate` is false, `validateScore`.
   */
  build(options: { validate?: boolean } = {}): Score {
    if (this.#masterBars.length === 0) this.#createMasterBar();
    const first = this.#masterBars[0];
    if (first && !first.tempo) first.tempo = { ...this.#tempo };
    const tracks =
      this.#tracks.length > 0 ? this.#tracks : [createTrack('fretted', { barCount: 0 })];
    const score: Score = {
      id: this.#id ?? newId(),
      meta: createScoreMeta(this.#meta),
      masterBars: this.#masterBars,
      tracks: tracks.map((track) => ({
        ...track,
        bars: [
          ...track.bars,
          ...Array.from({ length: this.#masterBars.length - track.bars.length }, () => createBar()),
        ],
      })),
    };
    const parsed = ScoreSchema.safeParse(score);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ScoreBuildError(
        `${issue?.path.join('.') ?? 'score'}: ${issue?.message ?? 'is invalid'}`,
      );
    }
    if (options.validate === false) return score;
    const violations = validateScore(score);
    if (violations.length > 0) {
      const lines = violations.map((v) => `${v.rule} at ${formatPath(v.path)}: ${v.message}`);
      throw new ScoreBuildError(`invalid score:\n${lines.join('\n')}`, violations);
    }
    return score;
  }

  #barIndex(): number {
    return this.#current ? this.#current.bars.length - 1 : this.#looseBars;
  }

  #createMasterBar(): MasterBar {
    const previous = this.#masterBars.at(-1);
    const masterBar = createMasterBar({
      timeSignature: { ...(previous?.timeSignature ?? this.#timeSignature) },
      keySignature: { ...(previous?.keySignature ?? this.#keySignature) },
    });
    this.#masterBars.push(masterBar);
    return masterBar;
  }

  #masterBar(): MasterBar {
    const index = this.#barIndex();
    if (index < 0) throw new Error('open a bar with bar() first');
    while (this.#masterBars.length <= index) this.#createMasterBar();
    const masterBar = this.#masterBars[index];
    if (!masterBar) throw new Error(`no master bar ${String(index)}`);
    return masterBar;
  }

  #beats(): Beat[] {
    if (!this.#current) throw new Error('beats belong to a track: call track() first');
    if (this.#current.bars.length === 0) this.bar();
    const bar = this.#current.bars.at(-1);
    const voice = bar?.voices[this.#voice];
    if (!voice) throw new Error(`no voice ${String(this.#voice)}`);
    return voice.beats;
  }
}

/** Starts a score; see `ScoreBuilder`. */
export function score(): ScoreBuilder {
  return new ScoreBuilder();
}
