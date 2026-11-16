import {
  TIE_REACH_BARS,
  chain,
  setBeatEffect,
  setNoteEffect,
  type Beat,
  type BeatChanges,
  type BeatEffects,
  type Bend,
  type Changes,
  type Command,
  type Harmonic,
  type Id,
  type Note,
  type NoteEffects,
  type SlideKind,
  type StrokeDirection,
  type Trill,
  type Whammy,
} from '@reprise/model';

import { effectTarget, type EffectTargetInput, type NoteRef } from './effect-targets';
import type { EntryPlan } from './entry';
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
  | { kind: 'trill'; trill: Trill }
  | { kind: 'bend'; bend: Bend; label?: string }
  | { kind: 'beatFlag'; flag: BeatFlag }
  | { kind: 'tremolo'; speed: 8 | 16 | 32 }
  | { kind: 'pickStroke'; direction: StrokeDirection }
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
  /** Why setting this item is refused, which refuses the whole action. */
  blocked?: string;
}

export type Resolved =
  | { refused: string }
  | { kind: 'note'; label: string; items: Item<Changes<NoteEffects>>[] }
  | { kind: 'beat'; label: string; items: Item<BeatChanges>[] };

const refuse = (refused: string): { refused: string } => ({ refused });

const FRETTED_ONLY = 'That effect needs a fretted track';
const NOTHING_SELECTED = 'Select a note first';

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The model's own bounds are a step in the change, not a shape the editor repeats. */
const SLIDE_GROUPS: readonly (readonly SlideKind[])[] = [
  ['shift', 'legato'],
  ['intoFromBelow', 'intoFromAbove'],
  ['outDown', 'outUp'],
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

/** A shift or legato slide, and a hammer-on, need a note to go to; the slide reaches one bar on. */
const SLIDE_REACH_BARS = 1;

interface NoteSpec {
  label: string;
  anyTrack: boolean;
  has(note: Note): boolean;
  present?(note: Note): boolean;
  set(note: Note): Changes<NoteEffects>;
  clear(note: Note): Changes<NoteEffects>;
  blocked?(ref: NoteRef): string | undefined;
}

function slideSpec(kind: SlideKind): NoteSpec {
  const group = SLIDE_GROUPS.find((peers) => peers.includes(kind)) ?? [kind];
  return {
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
    case 'harmonic':
      return valueSpec(
        `${action.harmonic.kind} harmonic`,
        (note) => note.harmonic,
        action.harmonic,
        { harmonic: action.harmonic },
        { harmonic: null },
      );
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
    case 'bend': {
      const prebend = action.bend.kind.startsWith('prebend');
      return valueSpec(
        action.label ?? 'bend',
        (note) => note.bend,
        action.bend,
        { bend: action.bend },
        { bend: null },
        {
          blocked: (ref) =>
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
  const items: Item<Changes<NoteEffects>>[] = [];
  for (const ref of refs) {
    if (ref.grace) continue;
    const target = nextOnString(
      ref.track,
      { bar: ref.bar, voice: ref.voice, beat: ref.index },
      ref.note.string,
      TIE_REACH_BARS,
    );
    if (!target) continue;
    const has = target.note.hammerPull;
    items.push({
      id: target.note.id,
      has,
      present: has,
      set: { hammerPull: true },
      clear: { hammerPull: false },
    });
  }
  const [first] = refs;
  if (items.length === 0 && first) {
    return refuse(`Nothing to hammer to on string ${String(first.note.string)}`);
  }
  return { kind: 'note', label: 'hammer-on or pull-off', items };
}

function resolveNotes(action: EffectAction, refs: readonly NoteRef[], spec: NoteSpec): Resolved {
  if (!spec.anyTrack && refs.some((ref) => ref.track.kind !== 'fretted')) {
    return refuse(FRETTED_ONLY);
  }
  // A shift or a legato slide goes somewhere: a note with nothing after it on its string is left out.
  const connects =
    action.kind === 'slide' && (action.slide === 'shift' || action.slide === 'legato');
  const used = connects
    ? refs.filter(
        (ref) =>
          !ref.grace &&
          nextOnString(
            ref.track,
            { bar: ref.bar, voice: ref.voice, beat: ref.index },
            ref.note.string,
            SLIDE_REACH_BARS,
          ),
      )
    : refs;
  const [first] = refs;
  if (used.length === 0 && first) {
    return refuse(`Nothing to slide to on string ${String(first.note.string)}`);
  }
  const items = used.map((ref) => {
    const blocked = spec.blocked?.(ref);
    const has = spec.has(ref.note);
    return {
      id: ref.note.id,
      has,
      present: spec.present ? spec.present(ref.note) : has,
      set: spec.set(ref.note),
      clear: spec.clear(ref.note),
      ...(blocked !== undefined && { blocked }),
    };
  });
  return { kind: 'note', label: spec.label, items };
}

/**
 * What an action does to each node of its target, before the toggle rule picks which to write.
 * Refusals are plain sentences for the status line.
 */
export function resolveEffect(input: EffectInput, action: EffectAction): Resolved {
  const target = effectTarget(input);
  const noteBased = noteSpec(action);
  if (noteBased || action.kind === 'hammer') {
    const refs = action.kind === 'flag' && action.wholeBeat ? target.beatNotes : target.notes;
    if (refs.length === 0) return refuse(NOTHING_SELECTED);
    if (!noteBased) {
      return refs.some((ref) => ref.track.kind !== 'fretted')
        ? refuse(FRETTED_ONLY)
        : resolveHammer(refs);
    }
    return resolveNotes(action, refs, noteBased);
  }
  const spec = beatSpec(action);
  if (!spec) return refuse(NOTHING_SELECTED);
  if (target.beats.length === 0) return refuse(NOTHING_SELECTED);
  if (!spec.anyTrack && target.beats.some((ref) => ref.track.kind !== 'fretted')) {
    return refuse(FRETTED_ONLY);
  }
  return {
    kind: 'beat',
    label: spec.label,
    items: target.beats.map(({ beat }) => {
      const has = spec.has(beat);
      return {
        id: beat.id,
        has,
        present: spec.present ? spec.present(beat) : has,
        set: spec.set,
        clear: spec.clear,
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
 * step under `label`, which the Undo menu shows.
 */
export function effectCommand(label: string, edits: EffectEdits): Command {
  return chain(label, [
    ...(edits.notes ?? []).map(({ noteId, effects }) => setNoteEffect({ noteId }, effects)),
    ...(edits.beats ?? []).map(({ beatId, changes }) => setBeatEffect({ beatId }, changes)),
  ]);
}

/**
 * The command that applies `action` to what the input selects, or why not. Guitar Pro's toggle:
 * when every target already has the effect it comes off all of them, else it goes on those that
 * lack it. Only nodes that change are written; when none do, `{ nothing: true }`.
 */
export function planEffect(
  input: EffectInput,
  action: EffectAction,
  mode: EffectMode = 'toggle',
): EntryPlan {
  const resolved = resolveEffect(input, action);
  if ('refused' in resolved) return resolved;
  const removing = mode === 'remove' || (mode === 'toggle' && resolved.items.every((i) => i.has));
  const label = removing ? `Remove ${resolved.label}` : capitalize(resolved.label);
  if (resolved.kind === 'note') {
    const chosen = resolved.items.filter((item) =>
      removing ? (mode === 'remove' ? item.present : item.has) : !item.has,
    );
    const blocked = removing ? undefined : chosen.find((item) => item.blocked !== undefined);
    if (blocked?.blocked) return refuse(blocked.blocked);
    if (chosen.length === 0) return { nothing: true };
    return {
      command: effectCommand(label, {
        notes: chosen.map((item) => ({
          noteId: item.id,
          effects: removing ? item.clear : item.set,
        })),
      }),
    };
  }
  const chosen = resolved.items.filter((item) =>
    removing ? (mode === 'remove' ? item.present : item.has) : !item.has,
  );
  if (chosen.length === 0) return { nothing: true };
  return {
    command: effectCommand(label, {
      beats: chosen.map((item) => ({
        beatId: item.id,
        changes: removing ? item.clear : item.set,
      })),
    }),
  };
}
