import {
  TIE_REACH_BARS,
  chain,
  maxStoredFret,
  setBeatEffects,
  setNoteEffects,
  writtenFret,
  type Beat,
  type BeatChanges,
  type BeatEffects,
  type Bend,
  type Changes,
  type Command,
  type Dynamics,
  type Harmonic,
  type Id,
  type Note,
  type NoteEffects,
  type Score,
  type SlideKind,
  type Golpe,
  type Wah,
  type PickScrape,
  type StrokeDirection,
  type Trill,
  type Whammy,
} from '@reprise/model';

import {
  effectTarget,
  type EffectTarget,
  type EffectTargetInput,
  type NoteRef,
} from './effect-targets';
import { scoreIndex } from '@/features/score';

import type { EditPlan } from './entry';
import { nextOnString } from './next-on-string';

export type NoteFlag = 'palmMute' | 'letRing' | 'dead' | 'ghost' | 'staccato';
export type BeatFlag = 'tapping' | 'slapping' | 'popping' | 'fadeIn' | 'fadeOut' | 'volumeSwell';

/** An effect a key, the panel or the palette applies. Values are the whole effect: a preset is one bend. */
export type EffectAction =
  | {
      kind: 'flag';
      flag: NoteFlag;
      /** On every note of the beats, not only the notes picked. */ wholeBeat?: boolean;
    }
  | { kind: 'accent'; accent: 'accent' | 'heavy' }
  | { kind: 'vibrato'; vibrato: 'slight' | 'wide' }
  | { kind: 'slide'; slide: SlideKind }
  /** Guitar Pro's H: the note picked is the origin, and the next note on its string takes `hammerPull`. */
  | { kind: 'hammer' }
  | { kind: 'harmonic'; harmonic: Harmonic }
  | { kind: 'dynamics'; dynamics: Dynamics }
  | { kind: 'trill'; trill: Trill }
  /** A trill to `interval` frets above each note, so a chord trills each of its notes. */
  | { kind: 'trillInterval'; interval: number; speed: Trill['speed'] }
  | { kind: 'bend'; bend: Bend; label?: string }
  | { kind: 'beatFlag'; flag: BeatFlag }
  | { kind: 'tremolo'; speed: 8 | 16 | 32 }
  | { kind: 'pickStroke'; direction: StrokeDirection }
  | { kind: 'golpe'; golpe: Golpe }
  | { kind: 'pickScrape'; direction: PickScrape }
  | { kind: 'wah'; wah: Wah }
  | { kind: 'beatVibrato'; vibrato: 'slight' | 'wide' }
  | { kind: 'whammy'; whammy: Whammy; label?: string }
  | { kind: 'brush'; direction: StrokeDirection }
  | { kind: 'arpeggio'; direction: StrokeDirection };

/**
 * `toggle` is Guitar Pro's rule: when every target already has the value it is removed, else it
 * is set on the rest. `set` only sets, and `remove` clears the effect whatever its value, which a
 * picker's "Remove" does.
 */
export type EffectMode = 'toggle' | 'set' | 'remove';

export type EffectInput = EffectTargetInput;

interface Item<C> {
  id: Id;
  /** Already exactly the value the action means. */
  has: boolean;
  /** Has the effect at all, with any value. */
  present: boolean;
  set: C;
  clear: C;
  /**
   * Why this item cannot take the effect. Setting skips it and says so, and refuses only when no
   * item can; removing ignores it, since an effect already there must always come off.
   */
  unavailable?: string;
}

export type Resolved =
  | { refused: string }
  | { kind: 'note'; label: string; items: Item<Changes<NoteEffects>>[] }
  | { kind: 'beat'; label: string; items: Item<BeatChanges>[] };

const refuse = (refused: string): { refused: string } => ({ refused });

/** What `createNote` gives a note, so what clearing a dynamic returns to. */
const DEFAULT_DYNAMICS: Dynamics = 'f';

const FRETTED_ONLY = 'That effect needs a fretted track';
const NOTHING_SELECTED = 'Select a note first';

/** Structural equality, blind to key order and to keys holding `undefined`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return (
    left.length === right.length &&
    left.every(([key, value]) => sameValue(value, Reflect.get(b, key)))
  );
}
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const SLIDE_GROUPS: readonly (readonly SlideKind[])[] = [
  // As in Guitar Pro (and alphaTab's single `slideOutType`): one way out of a note, one way in.
  ['shift', 'legato', 'outDown', 'outUp'],
  ['intoFromBelow', 'intoFromAbove'],
];

const SLIDE_LABEL: Record<SlideKind, string> = {
  shift: 'shift slide',
  legato: 'legato slide',
  intoFromBelow: 'slide in from below',
  intoFromAbove: 'slide in from above',
  outDown: 'slide out down',
  outUp: 'slide out up',
};

const FLAG_LABEL: Record<NoteFlag, string> = {
  palmMute: 'palm mute',
  letRing: 'let ring',
  dead: 'dead note',
  ghost: 'ghost note',
  staccato: 'staccato',
};

const FLAG_ON: Record<NoteFlag, Changes<NoteEffects>> = {
  palmMute: { palmMute: true },
  letRing: { letRing: true },
  dead: { dead: true },
  ghost: { ghost: true },
  staccato: { staccato: true },
};

const FLAG_OFF: Record<NoteFlag, Changes<NoteEffects>> = {
  palmMute: { palmMute: false },
  letRing: { letRing: false },
  dead: { dead: false },
  ghost: { ghost: false },
  staccato: { staccato: false },
};

const BEAT_FLAG_LABEL: Record<BeatFlag, string> = {
  tapping: 'tapping',
  slapping: 'slap',
  popping: 'pop',
  fadeIn: 'fade in',
  fadeOut: 'fade out',
  volumeSwell: 'volume swell',
};

/** Setting one clears the others of its group: the layout shows one, the file holds one. */
const BEAT_FLAG_ON: Record<BeatFlag, Changes<BeatEffects>> = {
  tapping: { tapping: true, slapping: null, popping: null },
  slapping: { slapping: true, tapping: null, popping: null },
  popping: { popping: true, tapping: null, slapping: null },
  fadeIn: { fadeIn: true, fadeOut: null, volumeSwell: null },
  fadeOut: { fadeOut: true, fadeIn: null, volumeSwell: null },
  volumeSwell: { volumeSwell: true, fadeIn: null, fadeOut: null },
};

const BEAT_FLAG_OFF: Record<BeatFlag, Changes<BeatEffects>> = {
  tapping: { tapping: null },
  slapping: { slapping: null },
  popping: { popping: null },
  fadeIn: { fadeIn: null },
  fadeOut: { fadeOut: null },
  volumeSwell: { volumeSwell: null },
};

/** Effects a drum or keyboard track takes: the ones that need no string. */
const ANY_TRACK_FLAGS: ReadonlySet<NoteFlag> = new Set<NoteFlag>(['ghost', 'staccato']);
const ANY_TRACK_BEAT_FLAGS: ReadonlySet<BeatFlag> = new Set<BeatFlag>([
  'fadeIn',
  'fadeOut',
  'volumeSwell',
]);

/** The highest fret a trill can go to: the neck, or a MIDI note off a fretted track. */
const trillTop = (ref: NoteRef): number =>
  ref.track.kind === 'fretted' ? maxStoredFret(ref.track, ref.note.string) : 127;

/** The fret as the tab shows it, for messages: a drone string stores its frets from its own nut. */
const shownFret = (ref: NoteRef, stored: number): number =>
  ref.track.kind === 'fretted'
    ? writtenFret(ref.track, { string: ref.note.string, fret: stored })
    : stored;

/** A shift or legato slide, and a hammer-on, need a note to go to; the slide reaches one bar on. */
const SLIDE_REACH_BARS = 1;

interface NoteSpec {
  label: string;
  anyTrack: boolean;
  has(note: Note): boolean;
  present?(note: Note): boolean;
  set(note: Note): Changes<NoteEffects>;
  clear(note: Note): Changes<NoteEffects>;
  /** Why a note cannot take the effect, when it cannot. */
  unavailable?(ref: NoteRef): string | undefined;
}

/**
 * The note a hammer-on or a shift or legato slide from `ref` goes to. A tied note is held, not
 * struck, so one is nothing to connect to. A grace note goes to the main note of its beat on its
 * string, as layout draws it.
 */
function connectionTarget(ref: NoteRef, reach: number): Note | undefined {
  if (ref.grace) {
    const main = ref.beat.notes.find((candidate) => candidate.string === ref.note.string);
    return main && !main.tie ? main : undefined;
  }
  const link = nextOnString(
    ref.track,
    { bar: ref.bar, voice: ref.voice, beat: ref.index },
    ref.note.string,
    reach,
  );
  return link && !link.note.tie ? link.note : undefined;
}

function slideSpec(kind: SlideKind): NoteSpec {
  const group = SLIDE_GROUPS.find((peers) => peers.includes(kind)) ?? [kind];
  const connects = kind === 'shift' || kind === 'legato';
  return {
    ...(connects && {
      unavailable: (ref: NoteRef) =>
        connectionTarget(ref, SLIDE_REACH_BARS)
          ? undefined
          : `Nothing to slide to on string ${String(ref.note.string)}`,
    }),
    label: SLIDE_LABEL[kind],
    anyTrack: false,
    has: (note) => note.slide?.includes(kind) ?? false,
    set: (note) => ({
      slide: [...(note.slide ?? []).filter((other) => !group.includes(other)), kind],
    }),
    clear: (note) => {
      const rest = (note.slide ?? []).filter((other) => other !== kind);
      return { slide: rest.length > 0 ? rest : null };
    },
  };
}

function valueSpec<T>(
  label: string,
  read: (note: Note) => T | undefined,
  value: T,
  set: Changes<NoteEffects>,
  clear: Changes<NoteEffects>,
  extra: Partial<NoteSpec> = {},
): NoteSpec {
  return {
    label,
    anyTrack: false,
    has: (note) => sameValue(read(note), value),
    present: (note) => read(note) !== undefined,
    set: () => set,
    clear: () => clear,
    ...extra,
  };
}

/**
 * A harmonic matches on its kind, and on its node only when the action names one: a gp3 to gp5
 * file stores a natural harmonic with its node, and Y must take that one off as well.
 */
function harmonicSpec(harmonic: Harmonic): NoteSpec {
  return {
    label: `${harmonic.kind} harmonic`,
    anyTrack: false,
    has: (note) =>
      note.harmonic?.kind === harmonic.kind &&
      (harmonic.value === undefined || note.harmonic.value === harmonic.value),
    present: (note) => note.harmonic !== undefined,
    set: () => ({ harmonic }),
    clear: () => ({ harmonic: null }),
  };
}

/** The spec of a note action; undefined for the hammer, which acts on another note. */
function noteSpec(action: EffectAction): NoteSpec | undefined {
  switch (action.kind) {
    case 'flag':
      return {
        label: FLAG_LABEL[action.flag],
        anyTrack: ANY_TRACK_FLAGS.has(action.flag),
        has: (note) => note[action.flag],
        set: () => FLAG_ON[action.flag],
        clear: () => FLAG_OFF[action.flag],
      };
    case 'accent': {
      const { accent } = action;
      return {
        label: accent === 'heavy' ? 'heavy accent' : 'accent',
        anyTrack: true,
        has: (note) => note.accent === accent,
        present: (note) => note.accent !== 'none',
        set: () => ({ accent }),
        clear: () => ({ accent: 'none' }),
      };
    }
    case 'vibrato': {
      const { vibrato } = action;
      return {
        label: vibrato === 'wide' ? 'wide vibrato' : 'vibrato',
        anyTrack: false,
        has: (note) => note.vibrato === vibrato,
        present: (note) => note.vibrato !== 'none',
        set: () => ({ vibrato }),
        clear: () => ({ vibrato: 'none' }),
      };
    }
    case 'slide':
      return slideSpec(action.slide);
    case 'pickScrape':
      return valueSpec(
        `pick scrape ${action.direction}`,
        (note) => note.pickScrape,
        action.direction,
        { pickScrape: action.direction },
        { pickScrape: null },
        {
          unavailable: (ref) =>
            ref.grace
              ? "A grace note can't take a pick scrape"
              : ref.note.tie
                ? 'A tied note is held, not struck'
                : undefined,
        },
      );
    case 'harmonic':
      return harmonicSpec(action.harmonic);
    case 'dynamics':
      return {
        label: `dynamics ${action.dynamics}`,
        anyTrack: true,
        has: (note) => note.dynamics === action.dynamics,
        // Every note has a dynamic; forte is the model's default and what Remove restores.
        present: (note) => note.dynamics !== DEFAULT_DYNAMICS,
        set: () => ({ dynamics: action.dynamics }),
        clear: () => ({ dynamics: DEFAULT_DYNAMICS }),
      };
    case 'trill':
      return valueSpec(
        'trill',
        (note) => note.trill,
        action.trill,
        { trill: action.trill },
        {
          trill: null,
        },
      );
    case 'trillInterval': {
      const { interval, speed } = action;
      return {
        label: 'trill',
        anyTrack: false,
        has: (note) => note.trill?.speed === speed && note.trill.fret === note.fret + interval,
        present: (note) => note.trill !== undefined,
        set: (note) => ({ trill: { fret: note.fret + interval, speed } }),
        clear: () => ({ trill: null }),
        unavailable: (ref) =>
          ref.note.fret + interval > trillTop(ref)
            ? `A trill to fret ${String(shownFret(ref, ref.note.fret + interval))} is off the neck`
            : undefined,
      };
    }
    case 'bend': {
      const prebend = action.bend.kind.startsWith('prebend');
      return valueSpec(
        action.label ?? 'bend',
        (note) => note.bend,
        action.bend,
        { bend: action.bend },
        { bend: null },
        {
          unavailable: (ref) =>
            prebend && ref.note.tie
              ? 'A tied note continues its bend; put the prebend on the first note'
              : undefined,
        },
      );
    }
    default:
      return undefined;
  }
}

interface BeatSpec {
  label: string;
  anyTrack: boolean;
  has(beat: Beat): boolean;
  present?(beat: Beat): boolean;
  set: BeatChanges;
  clear: BeatChanges;
  /** A rest can carry the effect: see `resolveEffect` for which rests join the target. */
  onRests?: boolean;
}

function strokeSpec(field: 'brush' | 'arpeggio', direction: StrokeDirection): BeatSpec {
  const stroke = { direction };
  // A beat holds one stroke, so setting one drops the other.
  return {
    label: `${field} ${direction}`,
    anyTrack: false,
    has: (beat) => beat.effects[field]?.direction === direction,
    present: (beat) => beat.effects[field] !== undefined,
    set: {
      effects:
        field === 'brush' ? { brush: stroke, arpeggio: null } : { arpeggio: stroke, brush: null },
    },
    clear: { effects: field === 'brush' ? { brush: null } : { arpeggio: null } },
  };
}

function beatSpec(action: EffectAction): BeatSpec | undefined {
  switch (action.kind) {
    case 'beatFlag': {
      const { flag } = action;
      return {
        label: BEAT_FLAG_LABEL[flag],
        anyTrack: ANY_TRACK_BEAT_FLAGS.has(flag),
        has: (beat) => beat.effects[flag] === true,
        set: { effects: BEAT_FLAG_ON[flag] },
        clear: { effects: BEAT_FLAG_OFF[flag] },
      };
    }
    case 'tremolo':
      return {
        label: 'tremolo picking',
        anyTrack: true,
        has: (beat) => beat.effects.tremoloPicking === action.speed,
        present: (beat) => beat.effects.tremoloPicking !== undefined,
        set: { effects: { tremoloPicking: action.speed } },
        clear: { effects: { tremoloPicking: null } },
      };
    case 'pickStroke':
      return {
        label: `pick stroke ${action.direction}`,
        anyTrack: false,
        has: (beat) => beat.effects.pickStroke === action.direction,
        present: (beat) => beat.effects.pickStroke !== undefined,
        set: { effects: { pickStroke: action.direction } },
        clear: { effects: { pickStroke: null } },
      };
    case 'golpe':
      // One field holds the value, so thumb and finger exclude each other; a rest may carry one.
      return {
        onRests: true,
        label: `golpe (${action.golpe})`,
        anyTrack: false,
        has: (beat) => beat.effects.golpe === action.golpe,
        present: (beat) => beat.effects.golpe !== undefined,
        set: { effects: { golpe: action.golpe } },
        clear: { effects: { golpe: null } },
      };
    case 'wah':
      // Open and closed share one field, so they exclude each other; a rest may carry a mark.
      return {
        onRests: true,
        label: `wah (${action.wah})`,
        anyTrack: false,
        has: (beat) => beat.effects.wah === action.wah,
        present: (beat) => beat.effects.wah !== undefined,
        set: { effects: { wah: action.wah } },
        clear: { effects: { wah: null } },
      };
    case 'beatVibrato':
      return {
        label: action.vibrato === 'wide' ? 'wide whammy-bar vibrato' : 'whammy-bar vibrato',
        anyTrack: false,
        has: (beat) => beat.effects.vibrato === action.vibrato,
        present: (beat) => beat.effects.vibrato !== undefined && beat.effects.vibrato !== 'none',
        set: { effects: { vibrato: action.vibrato } },
        clear: { effects: { vibrato: null } },
      };
    case 'whammy':
      return {
        label: action.label ?? 'whammy',
        anyTrack: false,
        has: (beat) => sameValue(beat.effects.whammy, action.whammy),
        present: (beat) => beat.effects.whammy !== undefined,
        set: { effects: { whammy: action.whammy } },
        clear: { effects: { whammy: null } },
      };
    case 'brush':
      return strokeSpec('brush', action.direction);
    case 'arpeggio':
      return strokeSpec('arpeggio', action.direction);
    default:
      return undefined;
  }
}

function resolveHammer(refs: readonly NoteRef[]): Resolved {
  const items = new Map<Id, Item<Changes<NoteEffects>>>();
  for (const ref of refs) {
    const unfretted = ref.track.kind !== 'fretted';
    const target = unfretted ? undefined : connectionTarget(ref, TIE_REACH_BARS);
    if (!target) {
      // Keyed by the origin: it has no target, so nothing of it is ever written.
      items.set(ref.note.id, {
        id: ref.note.id,
        has: false,
        present: false,
        set: {},
        clear: {},
        unavailable: unfretted
          ? FRETTED_ONLY
          : `Nothing to hammer to on string ${String(ref.note.string)}`,
      });
      continue;
    }
    const has = target.hammerPull;
    // Two grace notes on one string share the main note they hammer into.
    items.set(target.id, {
      id: target.id,
      has,
      present: has,
      set: { hammerPull: true },
      clear: { hammerPull: false },
    });
  }
  return { kind: 'note', label: 'hammer-on or pull-off', items: [...items.values()] };
}

function resolveNotes(refs: readonly NoteRef[], spec: NoteSpec): Resolved {
  const items = refs.map((ref) => {
    const unavailable =
      !spec.anyTrack && ref.track.kind !== 'fretted' ? FRETTED_ONLY : spec.unavailable?.(ref);
    const has = spec.has(ref.note);
    return {
      id: ref.note.id,
      has,
      present: spec.present ? spec.present(ref.note) : has,
      set: spec.set(ref.note),
      clear: spec.clear(ref.note),
      ...(unavailable !== undefined && { unavailable }),
    };
  });
  return { kind: 'note', label: spec.label, items };
}

/**
 * What an action does to each node of its target, before the toggle rule picks which to write.
 * Refusals are plain sentences for the status line; a node that cannot take the effect is marked
 * `unavailable` instead, so the rest of a mixed selection still gets it.
 */
export function resolveEffect(
  input: EffectInput,
  action: EffectAction,
  target: EffectTarget = effectTarget(input),
): Resolved {
  const noteBased = noteSpec(action);
  if (noteBased || action.kind === 'hammer') {
    const refs = action.kind === 'flag' && action.wholeBeat ? target.beatNotes : target.notes;
    if (refs.length === 0) return refuse(NOTHING_SELECTED);
    return noteBased ? resolveNotes(refs, noteBased) : resolveHammer(refs);
  }
  const spec = beatSpec(action);
  // A rest joins only when it already carries the effect (so a range toggle can take it off) or
  // when it is all that is targeted (the cursor on a rest, which can set it): a range never gets
  // the effect sprayed onto bare rests, and one bare rest does not turn a remove into a set.
  const rests = spec?.onRests
    ? target.rests.filter(({ beat }) => target.beats.length === 0 || spec.present?.(beat))
    : [];
  const targeted = [...target.beats, ...rests];
  if (!spec || targeted.length === 0) return refuse(NOTHING_SELECTED);
  return {
    kind: 'beat',
    label: spec.label,
    items: targeted.map(({ beat, track }) => {
      const has = spec.has(beat);
      return {
        id: beat.id,
        has,
        present: spec.present ? spec.present(beat) : has,
        set: spec.set,
        clear: spec.clear,
        ...(!spec.anyTrack && track.kind !== 'fretted' && { unavailable: FRETTED_ONLY }),
      };
    }),
  };
}

export interface EffectEdits {
  notes?: readonly { noteId: Id; effects: Changes<NoteEffects> }[];
  beats?: readonly { beatId: Id; changes: BeatChanges }[];
}

/**
 * The one place an effect becomes a model command: every edit of the action in a single history
 * step under `label`, which the Undo menu shows. Each batch is pushed only when it has edits,
 * since the model refuses an empty one.
 */
export function effectCommand(label: string, edits: EffectEdits): Command {
  const { notes = [], beats = [] } = edits;
  return chain(label, [
    ...(notes.length > 0 ? [setNoteEffects(notes)] : []),
    ...(beats.length > 0 ? [setBeatEffects(beats)] : []),
  ]);
}

/** An applied effect, with what was left out of a mixed selection, to show after it. */
export type EffectPlan = EditPlan & {
  notice?: string;
  /** The one beat to sound once the edit is committed (see `effectSound`). */
  beatSound?: EffectSound;
};
export interface EffectSound {
  track: Id;
  beat: Id;
}

/**
 * The beat to sound for an edit: the earliest beat the edit wrote (by bar, tick, then voice), on
 * the cursor's track when it wrote one there, else on the lowest track. `previewBeat` plays one
 * beat, so a range sounds its first. Ids survive the edit, so the score from before it will do.
 */
export function effectSound(
  score: Score,
  edits: EffectEdits,
  cursorTrack?: Id,
): EffectSound | undefined {
  const index = scoreIndex(score);
  const ids = [
    ...(edits.notes ?? []).flatMap(({ noteId }) => index.noteBeat.get(noteId) ?? []),
    ...(edits.beats ?? []).map(({ beatId }) => beatId),
  ];
  const found = ids.flatMap((beat) => {
    const info = index.beats.get(beat);
    const track = info && score.tracks[info.trackIndex];
    return info && track ? [{ beat, info, track: track.id }] : [];
  });
  const rank = (entry: (typeof found)[number]) =>
    [
      entry.track === cursorTrack ? 0 : 1,
      entry.info.trackIndex,
      entry.info.masterBarIndex,
      entry.info.tick,
      entry.info.voice,
    ] as const;
  found.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    const at = x.findIndex((value, i) => value !== y[i]);
    return at < 0 ? 0 : (x[at] ?? 0) - (y[at] ?? 0);
  });
  const [first] = found;
  return first && { track: first.track, beat: first.beat };
}
export type EffectResult = EffectPlan | { refused: string } | { nothing: true };

type Choice<C> =
  | { refused: string }
  | { nothing: true }
  | { removing: boolean; chosen: Item<C>[]; notice?: string };

/** Which items the toggle rule writes, and whether it removes. */
function choose<C>(items: readonly Item<C>[], mode: EffectMode): Choice<C> {
  const usable = items.filter((item) => item.unavailable === undefined || item.present);
  const removing =
    mode === 'remove' ||
    (mode === 'toggle' && usable.length > 0 && usable.every((item) => item.has));
  if (removing) {
    const chosen = items.filter((item) => (mode === 'remove' ? item.present : item.has));
    return chosen.length > 0 ? { removing, chosen } : { nothing: true };
  }
  const lacking = items.filter((item) => !item.has);
  const chosen = lacking.filter((item) => item.unavailable === undefined);
  const [first] = lacking.filter((item) => item.unavailable !== undefined);
  if (chosen.length === 0)
    return first?.unavailable ? refuse(first.unavailable) : { nothing: true };
  if (!first?.unavailable) return { removing, chosen };
  const skipped = items.length - chosen.length - items.filter((item) => item.has).length;
  return {
    removing,
    chosen,
    notice: `Skipped ${String(skipped)} of ${String(items.length)}: ${first.unavailable}`,
  };
}

/**
 * The command that applies `action` to what the input selects, or why not. Guitar Pro's toggle:
 * when every target that can take the effect already has it, it comes off all of them, else it
 * goes on those that lack it. Targets that cannot take it (a drum note for a fretted effect, a
 * slide with nothing to slide to) are skipped and counted in `notice`; only when none can is the
 * action refused. Only nodes that change are written; when none do, `{ nothing: true }`.
 */
export function planEffect(
  input: EffectInput,
  action: EffectAction,
  mode: EffectMode = 'toggle',
): EffectResult {
  const resolved = resolveEffect(input, action);
  if ('refused' in resolved) return resolved;
  const named = (removing: boolean) =>
    removing ? `Remove ${resolved.label}` : capitalize(resolved.label);
  if (resolved.kind === 'note') {
    const choice = choose(resolved.items, mode);
    if ('refused' in choice || 'nothing' in choice) return choice;
    const { removing, chosen, notice } = choice;
    const notes = chosen.map((item) => ({
      noteId: item.id,
      effects: removing ? item.clear : item.set,
    }));
    const beatSound = effectSound(input.score, { notes }, input.state.cursor?.track);
    return {
      command: effectCommand(named(removing), { notes }),
      ...(notice && { notice }),
      ...(beatSound && { beatSound }),
    };
  }
  const choice = choose(resolved.items, mode);
  if ('refused' in choice || 'nothing' in choice) return choice;
  const { removing, chosen, notice } = choice;
  const beats = chosen.map((item) => ({
    beatId: item.id,
    changes: removing ? item.clear : item.set,
  }));
  const beatSound = effectSound(input.score, { beats }, input.state.cursor?.track);
  return {
    command: effectCommand(named(removing), { beats }),
    ...(notice && { notice }),
    ...(beatSound && { beatSound }),
  };
}
