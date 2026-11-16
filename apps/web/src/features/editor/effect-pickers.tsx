import type { HarmonicKind, SlideKind } from '@reprise/model';
import { useId, useMemo, useState } from 'react';
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
import { effectInput } from './effect-dialogs';
import { effectState } from './effect-state';
import type { EffectAction, EffectMode } from './effects';
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

/** Default offset of a non-natural harmonic's node above the fretted note: the octave. */
const DEFAULT_NODE = 12;

interface Spec {
  title: string;
  description: string;
  /** `toggle` flips each choice as its key would; `set` sets it, and Remove clears the effect. */
  mode: EffectMode;
  choices(node: number): Choice[];
  columns: string;
  /** What Remove clears; absent when the choices are toggles. */
  removes?: EffectAction;
}

const SPECS: Record<EffectPicker, Spec> = {
  bend: {
    title: 'Bend',
    description: 'Choose a bend for the selected notes. It replaces any bend they have.',
    mode: 'set',
    columns: 'grid-cols-3',
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
    removes: { kind: 'bend', bend: { kind: 'bend', points: [] } },
  },
  slide: {
    title: 'Slide',
    description:
      'Each kind switches on or off for the selected notes; a note has one way in and one way out.',
    mode: 'toggle',
    columns: 'grid-cols-2',
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
    columns: 'grid-cols-3',
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
    removes: { kind: 'harmonic', harmonic: { kind: 'natural' } },
  },
  whammy: {
    title: 'Whammy bar',
    description: 'Choose a whammy-bar move for the selected beats. It replaces any move they have.',
    mode: 'set',
    columns: 'grid-cols-3',
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
    removes: { kind: 'whammy', whammy: { kind: 'dive', points: [] } },
  },
};

/**
 * One of the effect pickers as a modal dialog: a grid of choices the arrow keys move over, Enter
 * or Space applies and closes, and (where the effect has a value) Remove clears it. Each
 * application is one undo step. A refusal keeps the dialog open with the sentence in an alert, and
 * focus goes back to the control that opened it, or to where it was when a key did.
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
  const [node, setNode] = useState(String(DEFAULT_NODE));
  const [refusal, setRefusal] = useState<string>();
  const nodeId = useId();
  const nodeValue = Number(node);
  const nodeValid = node.trim() !== '' && Number.isFinite(nodeValue) && nodeValue >= 0;
  const choices = useMemo(
    () => spec.choices(nodeValid ? nodeValue : DEFAULT_NODE),
    [spec, nodeValid, nodeValue],
  );
  // What is on the target now, so the dialog opens on it: pressed for a value all of it has.
  const score = useStore(services.document, (state) => state.score);
  const selection = useStore(services.selection);
  const pressed = useMemo(() => {
    const input = effectInput(services);
    return input
      ? choices
          .filter(({ action }) => effectState(input, action) === 'on')
          .map(({ value }) => value)
      : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores' state is the dependency
  }, [choices, score, selection]);

  const apply = (action: EffectAction, mode: EffectMode) => {
    const outcome = applyEffect(services, action, mode);
    if ('refused' in outcome) setRefusal(outcome.refused);
    else onClose();
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
        {picker === 'harmonic' && (
          <div className="grid gap-1">
            <label htmlFor={nodeId} className="text-xs font-medium">
              Node above the fretted note (frets)
            </label>
            <Input
              id={nodeId}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={node}
              aria-invalid={!nodeValid}
              onChange={(event) => {
                setNode(event.target.value);
                setRefusal(undefined);
              }}
            />
            <p className="text-muted-foreground text-xs">
              A natural harmonic is the node of its own fret and ignores this.
            </p>
          </div>
        )}
        <ToggleGroup
          type="multiple"
          variant="outline"
          aria-label={spec.title}
          value={pressed}
          // Applying is the click, so a pressed choice can be applied again (a no-op that closes).
          onValueChange={() => undefined}
          className={`grid w-full gap-2 ${spec.columns}`}
        >
          {choices.map(({ value, label, action }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              disabled={
                picker === 'harmonic' &&
                !nodeValid &&
                action.kind === 'harmonic' &&
                action.harmonic.kind !== 'natural'
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
