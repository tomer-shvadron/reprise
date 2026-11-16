import type { Dynamics, HarmonicKind, SlideKind } from '@reprise/model';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import {
  BEND_AMOUNTS,
  BEND_SHAPES,
  bendPreset,
  bendPresetLabel,
  type BendAmount,
} from './bend-presets';
import type { EffectPicker } from './dialogs';
import { applyEffect } from './effect-commands';
import { PICKER_PROBE, effectInput } from './effect-dialogs';
import { effectState } from './effect-state';
import { effectTarget } from './effect-targets';
import type { EffectAction, EffectInput, EffectMode } from './effects';
import {
  WHAMMY_AMOUNTS,
  WHAMMY_SHAPES,
  whammyPreset,
  whammyPresetLabel,
  type WhammyAmount,
} from './whammy-presets';

interface Choice {
  value: string;
  label: string;
  action: EffectAction;
}

const SLIDES: readonly { slide: SlideKind; label: string }[] = [
  { slide: 'shift', label: 'Shift slide' },
  { slide: 'legato', label: 'Legato slide' },
  { slide: 'intoFromBelow', label: 'In from below' },
  { slide: 'intoFromAbove', label: 'In from above' },
  { slide: 'outDown', label: 'Out down' },
  { slide: 'outUp', label: 'Out up' },
];

const HARMONICS: readonly { kind: HarmonicKind; label: string }[] = [
  { kind: 'natural', label: 'Natural' },
  { kind: 'artificial', label: 'Artificial' },
  { kind: 'tapped', label: 'Tapped' },
  { kind: 'pinch', label: 'Pinch' },
  { kind: 'semi', label: 'Semi' },
  { kind: 'feedback', label: 'Feedback' },
];

const DYNAMICS: readonly Dynamics[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** Default offset of a non-natural harmonic's node above the fretted note: the octave. */
const DEFAULT_NODE = 12;
/** A trill goes to the fret two above: the usual trill. */
const TRILL_STEP = 2;

/** A number a choice carries and the player can type: the harmonic's node, the trill's fret. */
interface Field {
  label: string;
  hint: string;
  /** Its value on opening: the one the whole target shares, else a default. */
  seed(input: EffectInput | undefined): number;
  /** The most it can be, for the input's `max`. */
  max(input: EffectInput | undefined): number | undefined;
}

interface Spec {
  title: string;
  description: string;
  /** `toggle` flips each choice as its key would; `set` sets it, and Remove clears the effect. */
  mode: EffectMode;
  choices(field: number): Choice[];
  columns: number;
  /** What Remove clears; absent when the choices are toggles or cannot be removed. */
  removes?: EffectAction;
  field?: Field;
}

/** The value all of `values` share, or undefined when they differ or there are none. */
function shared(values: readonly (number | undefined)[]): number | undefined {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
}

const SPECS: Record<EffectPicker, Spec> = {
  bend: {
    title: 'Bend',
    description: 'Choose a bend for the selected notes. It replaces any bend they have.',
    mode: 'set',
    columns: 3,
    choices: () =>
      BEND_SHAPES.flatMap((shape) =>
        (Object.keys(BEND_AMOUNTS) as BendAmount[]).map((amount) => {
          const label = bendPresetLabel(shape, amount);
          return {
            value: `${shape}.${amount}`,
            label,
            action: { kind: 'bend', bend: bendPreset(shape, amount), label: label.toLowerCase() },
          } satisfies Choice;
        }),
      ),
    removes: PICKER_PROBE.bend,
  },
  slide: {
    title: 'Slide',
    description:
      'Each kind switches on or off for the selected notes; a note has one way in and one way out.',
    mode: 'toggle',
    columns: 2,
    choices: () =>
      SLIDES.map(({ slide, label }) => ({
        value: slide,
        label,
        action: { kind: 'slide', slide },
      })),
  },
  harmonic: {
    title: 'Harmonic',
    description: 'Choose a harmonic for the selected notes. It replaces any harmonic they have.',
    mode: 'set',
    columns: 3,
    field: {
      label: 'Node above the fretted note (frets)',
      hint: 'A natural harmonic is the node of its own fret and ignores this.',
      seed: (input) => {
        const notes = input ? effectTarget(input).notes : [];
        const harmonics = notes.map((ref) => ref.note.harmonic);
        const first = harmonics[0];
        // The value the target shares, when none of it is natural (which has no offset).
        return first && first.kind !== 'natural'
          ? (shared(harmonics.map((h) => (h?.kind === 'natural' ? undefined : h?.value))) ??
              DEFAULT_NODE)
          : DEFAULT_NODE;
      },
      max: () => undefined,
    },
    choices: (node) =>
      HARMONICS.map(({ kind, label }) => ({
        value: kind,
        label,
        // A natural harmonic is the node of its fret; the others sit above the fretted note.
        action: {
          kind: 'harmonic',
          harmonic: kind === 'natural' ? { kind } : { kind, value: node },
        },
      })),
    removes: PICKER_PROBE.harmonic,
  },
  whammy: {
    title: 'Whammy bar',
    description: 'Choose a whammy-bar move for the selected beats. It replaces any move they have.',
    mode: 'set',
    columns: 3,
    choices: () =>
      WHAMMY_SHAPES.flatMap((shape) =>
        (Object.keys(WHAMMY_AMOUNTS) as WhammyAmount[]).map((amount) => {
          const label = whammyPresetLabel(shape, amount);
          return {
            value: `${shape}.${amount}`,
            label,
            action: {
              kind: 'whammy',
              whammy: whammyPreset(shape, amount),
              label: `whammy ${label.toLowerCase()}`,
            },
          } satisfies Choice;
        }),
      ),
    removes: PICKER_PROBE.whammy,
  },
  tremolo: {
    title: 'Tremolo picking',
    description: 'Choose how fast the selected beats are picked. The key toggles the 32nd notes.',
    mode: 'set',
    columns: 3,
    choices: () =>
      ([8, 16, 32] as const).map((speed) => ({
        value: String(speed),
        label: `${String(speed)}th notes`,
        action: { kind: 'tremolo', speed },
      })),
    removes: PICKER_PROBE.tremolo,
  },
  trill: {
    title: 'Trill',
    description: 'Choose the speed of a trill to the fret below, on the selected notes.',
    mode: 'set',
    columns: 3,
    field: {
      label: 'Trill to fret',
      hint: 'The fret the note alternates with.',
      seed: (input) => {
        const refs = input ? effectTarget(input).notes : [];
        const first = refs[0];
        if (!first) return 0;
        const trilled = shared(refs.map((ref) => ref.note.trill?.fret));
        const top = first.track.kind === 'fretted' ? first.track.fretCount : 127;
        return trilled ?? Math.min(first.note.fret + TRILL_STEP, top);
      },
      max: (input) => {
        const track = input ? effectTarget(input).notes[0]?.track : undefined;
        return track?.kind === 'fretted' ? track.fretCount : 127;
      },
    },
    choices: (fret) =>
      ([16, 32, 64] as const).map((speed) => ({
        value: String(speed),
        label: `${String(speed)}th notes`,
        action: { kind: 'trill', trill: { fret, speed } },
      })),
    removes: PICKER_PROBE.trill,
  },
  dynamics: {
    title: 'Dynamics',
    description: 'Choose how loud the selected notes are played.',
    mode: 'set',
    columns: 4,
    choices: () =>
      DYNAMICS.map((dynamics) => ({
        value: dynamics,
        label: dynamics,
        action: { kind: 'dynamics', dynamics },
      })),
  },
};

const COLUMNS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

/**
 * One of the effect pickers as a modal dialog: a grid of choices (Left and Right walk them in
 * reading order, Up and Down move by row), Enter or Space applies and closes, and where the effect
 * has a value Remove clears it. It opens on what the target already has: that choice pressed and
 * focused, and a typed value filled in. Each application is one undo step. A refusal keeps the
 * dialog open with the sentence in an alert, and only there. Focus goes back to the control that
 * opened it when that was the keyboard, else to where it was.
 */
export function EffectPickerDialog({
  picker,
  onClose,
  onCloseAutoFocus,
}: {
  picker: EffectPicker;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const services = useAppServices();
  const spec = SPECS[picker];
  const [seed] = useState(() => {
    const input = effectInput(services);
    return {
      value: String(spec.field?.seed(input) ?? 0),
      max: spec.field?.max(input),
    };
  });
  const [typed, setTyped] = useState(seed.value);
  const [refusal, setRefusal] = useState<string>();
  const fieldId = useId();
  const typedNumber = Number(typed);
  const typedValid =
    typed.trim() !== '' &&
    Number.isFinite(typedNumber) &&
    typedNumber >= 0 &&
    (seed.max === undefined || typedNumber <= seed.max);
  const choices = useMemo(
    () => spec.choices(typedValid ? typedNumber : 0),
    [spec, typedValid, typedNumber],
  );
  // What is on the target now, so the dialog opens on it: pressed for a value all of it has.
  const score = useStore(services.document, (state) => state.score);
  const selection = useStore(services.selection);
  const pressed = useMemo(() => {
    const input = effectInput(services);
    if (!input) return [];
    const target = effectTarget(input);
    return choices
      .filter(({ action }) => effectState(input, action, target) === 'on')
      .map(({ value }) => value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores' state is the dependency
  }, [choices, score, selection]);

  const apply = (action: EffectAction, mode: EffectMode) => {
    const outcome = applyEffect(services, action, mode, true);
    if ('refused' in outcome) setRefusal(outcome.refused);
    else onClose();
  };

  // The grid is two-dimensional but roving focus is a line: Up and Down jump a row.
  const moveByRow = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="button"], button')];
    const at = items.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    // Radix would also step to the next item; this is the one move.
    event.stopPropagation();
    items[at + (event.key === 'ArrowDown' ? spec.columns : -spec.columns)]?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        {...(onCloseAutoFocus && { onCloseAutoFocus })}
      >
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        {spec.field && (
          <div className="grid gap-1">
            <label htmlFor={fieldId} className="text-xs font-medium">
              {spec.field.label}
            </label>
            <Input
              id={fieldId}
              type="number"
              inputMode="decimal"
              min={0}
              {...(seed.max !== undefined && { max: seed.max })}
              step="any"
              value={typed}
              aria-invalid={!typedValid}
              onChange={(event) => {
                setTyped(event.target.value);
                setRefusal(undefined);
              }}
            />
            <p className="text-muted-foreground text-xs">{spec.field.hint}</p>
          </div>
        )}
        <ToggleGroup
          type="multiple"
          variant="outline"
          aria-label={spec.title}
          value={pressed}
          // Applying is the click, so a pressed choice can be applied again (a no-op that closes).
          onValueChange={() => undefined}
          onKeyDownCapture={moveByRow}
          className={`grid w-full gap-2 ${COLUMNS[spec.columns] ?? 'grid-cols-3'}`}
        >
          {choices.map(({ value, label, action }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              disabled={
                spec.field !== undefined &&
                !typedValid &&
                !(action.kind === 'harmonic' && action.harmonic.kind === 'natural')
              }
              className="h-auto min-h-8 py-1.5 text-xs whitespace-normal"
              onClick={() => {
                apply(action, spec.mode);
              }}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {refusal !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {refusal}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {spec.removes && (
            <Button
              variant="destructive"
              onClick={() => {
                if (spec.removes) apply(spec.removes, 'remove');
              }}
            >
              Remove
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
