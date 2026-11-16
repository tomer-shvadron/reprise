import { useId, useState, type SyntheticEvent } from 'react';

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

import { commitEffectPlan } from './effect-commands';
import { effectInput } from './effect-dialogs';
import {
  GRACE_DURATIONS,
  defaultGraceForm,
  graceFretError,
  planGrace,
  type GraceDuration,
  type GraceForm,
  type GraceTransition,
} from './grace-form';

const SELECT_CLASS = 'border-input bg-background h-8 w-full min-w-0 rounded-lg border px-2 text-sm';

const TRANSITIONS: readonly { value: GraceTransition; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'slide', label: 'Slide into the note' },
  { value: 'hammer', label: 'Hammer-on to the note' },
];

/**
 * A grace note on the selected beats: its fret, length, whether it falls before the beat or on
 * it, how it joins the main note, and whether it is dead. Applies as one undo step; on a beat that
 * already has grace notes it opens on them and offers Remove. A fret off the neck keeps the dialog
 * open with the model's sentence.
 */
export function GraceDialog({
  before,
  onClose,
  onCloseAutoFocus,
}: {
  before: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const services = useAppServices();
  const [initial] = useState(() => {
    const input = effectInput(services);
    return input ? defaultGraceForm(input, before) : undefined;
  });
  const [form, setForm] = useState<GraceForm | undefined>(initial?.form);
  const [fret, setFret] = useState(String(initial?.form.fret ?? 0));
  const [refusal, setRefusal] = useState<string>();
  const ids = useId();
  const id = (field: string) => `${ids}-${field}`;
  if (!initial || !form) return null;

  const fretNumber = fret.trim() === '' ? Number.NaN : Number(fret);
  const fretError = graceFretError(fretNumber);
  const update = (patch: Partial<GraceForm>) => {
    setForm({ ...form, ...patch });
    setRefusal(undefined);
  };

  const run = (what: GraceForm | 'remove') => {
    const input = effectInput(services);
    if (!input) return;
    const outcome = commitEffectPlan(services, planGrace(input, what), true);
    if ('refused' in outcome) setRefusal(outcome.refused);
    else onClose();
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (fretError === undefined) run({ ...form, fret: fretNumber });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={false}
        {...(onCloseAutoFocus && { onCloseAutoFocus })}
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Grace note</DialogTitle>
            <DialogDescription>
              {initial.existing
                ? 'The selected beats have grace notes. Apply replaces them; Remove clears them.'
                : 'Adds a grace note on each selected string.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <label htmlFor={id('fret')} className="text-xs font-medium">
              Fret
            </label>
            <Input
              id={id('fret')}
              type="number"
              inputMode="numeric"
              min={0}
              value={fret}
              aria-invalid={fretError !== undefined}
              aria-describedby={fretError === undefined ? undefined : id('fret-error')}
              onChange={(event) => {
                setFret(event.target.value);
                setRefusal(undefined);
              }}
            />
            {fretError !== undefined && (
              <p id={id('fret-error')} className="text-destructive text-xs">
                {fretError}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <label htmlFor={id('duration')} className="text-xs font-medium">
                Length
              </label>
              <select
                id={id('duration')}
                className={SELECT_CLASS}
                value={form.duration}
                onChange={(event) => {
                  update({ duration: Number(event.target.value) as GraceDuration });
                }}
              >
                {GRACE_DURATIONS.map((value) => (
                  <option key={value} value={value}>
                    {`1/${String(value)}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label htmlFor={id('place')} className="text-xs font-medium">
                Placement
              </label>
              <select
                id={id('place')}
                className={SELECT_CLASS}
                value={form.before ? 'before' : 'on'}
                onChange={(event) => {
                  update({ before: event.target.value === 'before' });
                }}
              >
                <option value="before">Before the beat</option>
                <option value="on">On the beat</option>
              </select>
            </div>
          </div>
          <div className="grid gap-1">
            <label htmlFor={id('transition')} className="text-xs font-medium">
              Transition
            </label>
            <select
              id={id('transition')}
              className={SELECT_CLASS}
              value={form.transition}
              onChange={(event) => {
                update({ transition: event.target.value as GraceTransition });
              }}
            >
              {TRANSITIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label htmlFor={id('dead')} className="flex items-center gap-1.5 text-sm">
            <input
              id={id('dead')}
              type="checkbox"
              checked={form.dead}
              onChange={(event) => {
                update({ dead: event.target.checked });
              }}
            />
            Dead note
          </label>
          {refusal !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {refusal}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {initial.existing && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  run('remove');
                }}
              >
                Remove
              </Button>
            )}
            <Button type="submit" disabled={fretError !== undefined}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
