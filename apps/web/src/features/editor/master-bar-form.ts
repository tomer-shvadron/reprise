import {
  ALTERNATE_ENDING_MAX,
  DEFAULT_BPM,
  JumpKindSchema,
  barTicks,
  beatTicks,
  type DirectionTarget,
  type Id,
  type JumpKind,
  type MasterBar,
  type MasterBarChanges,
  type Score,
  type TimeSignature,
} from '@reprise/model';

import type { BarTarget } from './bar-edit';

export const DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;
export const JUMP_KINDS: readonly JumpKind[] = JumpKindSchema.options;
export const ENDINGS = Array.from({ length: ALTERNATE_ENDING_MAX }, (_, index) => index + 1);
export const TEMPO_RANGE = { min: 20, max: 400 } as const;
export const PLAY_COUNT_RANGE = { min: 2, max: 99 } as const;
const DEFAULT_PLAY_COUNT = 2;

/** The fields a player edits, each one written only once it is touched. */
export type FieldKey =
  | 'time'
  | 'key'
  | 'mode'
  | 'tempo'
  | 'repeatStart'
  | 'repeatEnd'
  | 'endings'
  | 'jump'
  | 'segno'
  | 'segnoSegno'
  | 'coda'
  | 'doubleCoda'
  | 'fine'
  | 'section';

type Flags = Partial<Record<FieldKey, true>>;

/** A jump select value: no jump, one kind, or several the dialog leaves alone. */
export type JumpChoice = JumpKind | '' | 'several';

/** Text for the number fields, so a half-typed value is still a value. */
export interface MasterBarForm {
  time: { numerator: string; denominator: string };
  key: { fifths: number; minor: boolean };
  /** Extend a time or key change to the bars after the target that had the same old signature. */
  continueSignatures: boolean;
  tempo: { on: boolean; bpm: string };
  repeatStart: boolean;
  repeatEnd: { on: boolean; count: string };
  endings: number[];
  jump: JumpChoice;
  segno: boolean;
  segnoSegno: boolean;
  coda: boolean;
  doubleCoda: boolean;
  fine: boolean;
  section: { name: string; letter: string };
  /** Fields whose bars differ: shown empty until the player sets them. */
  mixed: Flags;
  touched: Flags;
  /** Whether the target starts on the first bar, whose tempo mark cannot be removed. */
  firstBar: boolean;
}

const indexOf = (score: Score, id: Id) => score.masterBars.findIndex((bar) => bar.id === id);
const barOf = (score: Score, id: Id): MasterBar | undefined => score.masterBars[indexOf(score, id)];

const sameTime = (a: TimeSignature, b: TimeSignature) =>
  a.numerator === b.numerator && a.denominator === b.denominator;

/** The tempo in force at a bar: its own mark, else the nearest one before it. */
function effectiveBpm(score: Score, index: number): number {
  for (let at = index; at >= 0; at--) {
    const bpm = score.masterBars[at]?.tempo?.bpm;
    if (bpm !== undefined) return bpm;
  }
  return DEFAULT_BPM;
}

function jumpChoice(bar: MasterBar): JumpChoice {
  const [only] = bar.jumps;
  if (bar.jumps.length > 1) return 'several';
  return only ? only.kind : '';
}

/** The form for `target`: first-bar fields from its first bar, last-bar fields from its last. */
export function formFromScore(score: Score, target: BarTarget): MasterBarForm | undefined {
  const bars = target.ids.map((id) => barOf(score, id));
  const first = barOf(score, target.first);
  const last = barOf(score, target.last);
  if (!first || !last || bars.some((bar) => bar === undefined)) return undefined;
  const present = bars.filter((bar): bar is MasterBar => bar !== undefined);
  const mixed: Flags = {};
  if (present.some((bar) => !sameTime(bar.timeSignature, first.timeSignature))) mixed.time = true;
  // Key and mode are mixed on their own: touching one must keep each bar's value of the other.
  if (present.some((bar) => bar.keySignature.fifths !== first.keySignature.fifths)) {
    mixed.key = true;
  }
  if (present.some((bar) => bar.keySignature.minor !== first.keySignature.minor)) {
    mixed.mode = true;
  }
  if (present.some((bar) => bar.alternateEndings.join() !== first.alternateEndings.join())) {
    mixed.endings = true;
  }
  const firstIndex = indexOf(score, target.first);
  return {
    time: mixed.time
      ? { numerator: '', denominator: '' }
      : {
          numerator: String(first.timeSignature.numerator),
          denominator: String(first.timeSignature.denominator),
        },
    key: { ...first.keySignature },
    continueSignatures: true,
    tempo: { on: first.tempo !== undefined, bpm: String(effectiveBpm(score, firstIndex)) },
    repeatStart: first.repeat.start,
    repeatEnd: {
      on: last.repeat.endCount > 0,
      count: String(last.repeat.endCount > 0 ? last.repeat.endCount : DEFAULT_PLAY_COUNT),
    },
    endings: mixed.endings ? [] : [...first.alternateEndings],
    jump: jumpChoice(last),
    segno: first.targets.includes('segno'),
    segnoSegno: first.targets.includes('segnoSegno'),
    coda: first.targets.includes('coda'),
    doubleCoda: first.targets.includes('doubleCoda'),
    fine: last.targets.includes('fine'),
    section: { name: first.section?.name ?? '', letter: first.section?.letter ?? '' },
    mixed,
    touched: {},
    firstBar: firstIndex === 0,
  };
}

/** Sets fields and marks `key` touched, so it is written and no longer mixed. */
export function edit(
  form: MasterBarForm,
  key: FieldKey,
  patch: Partial<Omit<MasterBarForm, 'mixed' | 'touched'>>,
): MasterBarForm {
  const mixed: Flags = Object.fromEntries(
    Object.entries(form.mixed).filter(([field]) => field !== key),
  );
  return { ...form, ...patch, mixed, touched: { ...form.touched, [key]: true } };
}

export interface MasterBarFormErrors {
  numerator?: string;
  denominator?: string;
  tempo?: string;
  count?: string;
}

const integer = (text: string): number | undefined => {
  const value = Number(text);
  return text.trim() !== '' && Number.isInteger(value) ? value : undefined;
};

/** Field ranges, checked before the model sees anything; structural rules are the model's. */
export function validateMasterBarForm(form: MasterBarForm): MasterBarFormErrors {
  const errors: MasterBarFormErrors = {};
  if (form.touched.time) {
    const numerator = integer(form.time.numerator);
    if (numerator === undefined || numerator < 1 || numerator > 32) {
      errors.numerator = 'Beats per bar is a whole number from 1 to 32';
    }
    const denominator = integer(form.time.denominator);
    if (!DENOMINATORS.some((allowed) => allowed === denominator)) {
      errors.denominator = 'Pick a beat length';
    }
  }
  if (form.touched.tempo && form.tempo.on) {
    const bpm = Number(form.tempo.bpm);
    if (
      form.tempo.bpm.trim() === '' ||
      !Number.isFinite(bpm) ||
      bpm < TEMPO_RANGE.min ||
      bpm > TEMPO_RANGE.max
    ) {
      errors.tempo = `Tempo is a number from ${String(TEMPO_RANGE.min)} to ${String(TEMPO_RANGE.max)}`;
    }
  }
  if (form.touched.repeatEnd && form.repeatEnd.on) {
    const count = integer(form.repeatEnd.count);
    if (count === undefined || count < PLAY_COUNT_RANGE.min || count > PLAY_COUNT_RANGE.max) {
      errors.count = `Play count is a whole number from ${String(PLAY_COUNT_RANGE.min)} to ${String(PLAY_COUNT_RANGE.max)}`;
    }
  }
  return errors;
}

export const hasErrors = (errors: MasterBarFormErrors): boolean => Object.keys(errors).length > 0;

const TARGET_ORDER: readonly DirectionTarget[] = [
  'segno',
  'segnoSegno',
  'coda',
  'doubleCoda',
  'fine',
];

export interface MasterBarEditPlan {
  masterBarId: Id;
  changes: MasterBarChanges;
}

/**
 * The bars after `last` that share its old value, so a change reads "until the next change":
 * the run stops at the first bar that already differs.
 */
function continuation(score: Score, last: Id, same: (bar: MasterBar, old: MasterBar) => boolean) {
  const lastIndex = indexOf(score, last);
  const old = score.masterBars[lastIndex];
  const ids: Id[] = [];
  if (!old) return ids;
  for (const bar of score.masterBars.slice(lastIndex + 1)) {
    if (!same(bar, old)) break;
    ids.push(bar.id);
  }
  return ids;
}

/**
 * The per-bar changes a form stands for, only for the fields the player touched. Repeat start,
 * tempo, section and the segno and coda go on the first bar; repeat end, the jump and Fine on
 * the last; endings on every bar; time and key on every bar and, with `continueSignatures`, on
 * the bars after until one already differs. Bars with nothing to change are left out.
 */
export function masterBarEdits(
  score: Score,
  target: BarTarget,
  form: MasterBarForm,
): MasterBarEditPlan[] {
  const changes = new Map<Id, MasterBarChanges>();
  const set = (id: Id, patch: MasterBarChanges) => {
    changes.set(id, { ...changes.get(id), ...patch });
  };
  const { touched } = form;

  if (touched.time) {
    // The form is validated first, so a denominator outside the list means no time change.
    const denominator = DENOMINATORS.find((value) => value === Number(form.time.denominator));
    const timeSignature: TimeSignature | undefined = denominator && {
      numerator: Number(form.time.numerator),
      denominator,
    };
    const extra = form.continueSignatures
      ? continuation(score, target.last, (bar, old) =>
          sameTime(bar.timeSignature, old.timeSignature),
        )
      : [];
    if (timeSignature) {
      for (const id of [...target.ids, ...extra]) set(id, { timeSignature: { ...timeSignature } });
    }
  }
  if (touched.key || touched.mode) {
    const sameKey = (bar: MasterBar, old: MasterBar) =>
      bar.keySignature.fifths === old.keySignature.fifths &&
      bar.keySignature.minor === old.keySignature.minor;
    const extra = form.continueSignatures ? continuation(score, target.last, sameKey) : [];
    // Each bar keeps the half of its key the player did not touch.
    for (const id of [...target.ids, ...extra]) {
      const own = barOf(score, id)?.keySignature;
      if (!own) continue;
      set(id, {
        keySignature: {
          fifths: touched.key ? form.key.fifths : own.fifths,
          minor: touched.mode ? form.key.minor : own.minor,
        },
      });
    }
  }
  if (touched.endings) {
    for (const id of target.ids)
      set(id, { alternateEndings: [...form.endings].sort((a, b) => a - b) });
  }

  const first = barOf(score, target.first);
  const last = barOf(score, target.last);
  if (first) {
    if (touched.tempo) {
      set(
        first.id,
        form.tempo.on
          ? { tempo: { ...first.tempo, bpm: Number(form.tempo.bpm) } }
          : { tempo: null },
      );
    }
    if (touched.section) {
      const name = form.section.name.trim();
      const letter = form.section.letter.trim();
      set(
        first.id,
        name === ''
          ? { section: null }
          : {
              section: {
                name,
                ...(letter !== '' && { letter }),
                ...(first.section?.color !== undefined && { color: first.section.color }),
              },
            },
      );
    }
  }
  // First bar and last bar can be one bar: repeat start and end then share one `repeat` value.
  const repeatStart = touched.repeatStart ? form.repeatStart : undefined;
  const repeatEnd = touched.repeatEnd
    ? form.repeatEnd.on
      ? Number(form.repeatEnd.count)
      : 0
    : undefined;
  if (first && repeatStart !== undefined) {
    set(first.id, { repeat: { start: repeatStart, endCount: first.repeat.endCount } });
  }
  if (last && repeatEnd !== undefined) {
    const current = changes.get(last.id)?.repeat ?? last.repeat;
    set(last.id, { repeat: { start: current.start, endCount: repeatEnd } });
  }
  if (last && touched.jump && form.jump !== 'several') {
    set(last.id, { jumps: form.jump === '' ? [] : [{ kind: form.jump }] });
  }

  const flags: [FieldKey & DirectionTarget, Id | undefined][] = [
    ['segno', first?.id],
    ['segnoSegno', first?.id],
    ['coda', first?.id],
    ['doubleCoda', first?.id],
    ['fine', last?.id],
  ];
  for (const [name, id] of flags) {
    if (!touched[name] || id === undefined) continue;
    const bar = barOf(score, id);
    const current = changes.get(id)?.targets ?? bar?.targets ?? [];
    const next = form[name]
      ? [...current.filter((entry) => entry !== name), name]
      : current.filter((entry) => entry !== name);
    set(id, {
      targets: TARGET_ORDER.filter((entry) => next.includes(entry)).concat(
        next.filter((entry) => !TARGET_ORDER.includes(entry)),
      ),
    });
  }

  // "Touched" is the player typing in a field, not the value changing: a field left at what the
  // bar already has makes no change, and a bar with none makes no edit.
  return score.masterBars.flatMap((bar) => {
    const wanted = changes.get(bar.id);
    if (!wanted) return [];
    const differing = Object.fromEntries(
      Object.entries(wanted).filter(([key, value]) =>
        value === null
          ? Reflect.get(bar, key) !== undefined
          : !sameValue(Reflect.get(bar, key), value),
      ),
    );
    return Object.keys(differing).length === 0 ? [] : [{ masterBarId: bar.id, changes: differing }];
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = Object.entries(a);
  return (
    left.length === Object.keys(b).length &&
    left.every(([key, value]) => sameValue(value, Reflect.get(b, key)))
  );
}

/**
 * Bar numbers (1-based) a time edit would cut notes off: the model's own condition, a signature
 * that gets smaller under a voice that fitted the old one. A bar imported over-full that gains
 * room, or keeps it, is not named.
 */
export function overfullBars(score: Score, edits: readonly MasterBarEditPlan[]): number[] {
  const numbers: number[] = [];
  for (const { masterBarId, changes } of edits) {
    const index = indexOf(score, masterBarId);
    const bar = score.masterBars[index];
    if (!bar || !changes.timeSignature) continue;
    const before = barTicks(bar) + 1e-6;
    const after = barTicks({ ...bar, timeSignature: changes.timeSignature }) + 1e-6;
    if (after >= before) continue;
    const cut = score.tracks.some((track) =>
      (track.bars[index]?.voices ?? []).some((voice) => {
        const used = voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
        return used > after && used <= before;
      }),
    );
    if (cut) numbers.push(index + 1);
  }
  return numbers;
}

/** Bar numbers as runs, "3–5, 8", as the track dialog writes them. */
function runs(numbers: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let at = 1; at <= numbers.length; at++) {
    if (at < numbers.length && numbers[at] === (numbers[at - 1] ?? 0) + 1) continue;
    const from = numbers[start];
    const to = numbers[at - 1];
    parts.push(from === to ? String(from) : `${String(from)}–${String(to)}`);
    start = at;
  }
  const last = parts.pop();
  return parts.length === 0 ? (last ?? '') : `${parts.join(', ')} and ${last ?? ''}`;
}

/** The refusal for notes a smaller time signature would cut off, naming the bars. */
export function overfullMessage(
  score: Score,
  edits: readonly MasterBarEditPlan[],
  numbers: readonly number[],
): string {
  const [first] = numbers;
  const change = edits.find(({ masterBarId }) => indexOf(score, masterBarId) + 1 === first)?.changes
    .timeSignature;
  const sign = change
    ? `${String(change.numerator)}/${String(change.denominator)}`
    : 'that signature';
  const many = numbers.length > 1 || runs(numbers).includes('–');
  return `${many ? 'Bars' : 'Bar'} ${runs(numbers)} ${many ? 'hold' : 'holds'} more than ${sign} allows: shorten or delete the notes first`;
}

const NOTE_NAMES = {
  major: ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'],
  minor: ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'],
} as const;

/** "G major, 1♯": the key a signature names, and how many accidentals it carries. */
export function keyLabel(fifths: number, minor: boolean): string {
  const name = NOTE_NAMES[minor ? 'minor' : 'major'][fifths + 7] ?? '';
  const accidentals =
    fifths === 0 ? 'no sharps or flats' : `${String(Math.abs(fifths))}${fifths > 0 ? '♯' : '♭'}`;
  return `${name} ${minor ? 'minor' : 'major'}, ${accidentals}`;
}

export const KEY_FIFTHS = Array.from({ length: 15 }, (_, index) => index - 7);

/** "Bar 5" or "Bars 5–6". */
export function targetTitle(score: Score, target: BarTarget): string {
  const first = indexOf(score, target.first) + 1;
  const last = indexOf(score, target.last) + 1;
  return first === last ? `Bar ${String(first)}` : `Bars ${String(first)}–${String(last)}`;
}

/** The line under the title: where each field lands when the target is a range. */
export function placementNote(score: Score, target: BarTarget): string | undefined {
  if (target.first === target.last) return undefined;
  const first = indexOf(score, target.first) + 1;
  const last = indexOf(score, target.last) + 1;
  return `Repeat start, tempo, section, segno and coda go on bar ${String(first)}; repeat end, jump and Fine on bar ${String(last)}. Endings, time and key apply to every bar.`;
}
