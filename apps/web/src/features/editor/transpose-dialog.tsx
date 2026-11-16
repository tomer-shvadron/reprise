import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';

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

import { applyTranspose, transposeInput } from './transpose-commands';
import {
  SEMITONES_MAX,
  SEMITONES_MIN,
  defaultScope,
  lastSemitones,
  rememberSemitones,
  scopeOffer,
  semitoneError,
  semitoneLabel,
} from './transpose-form';
import { selectionCount, type TransposeScope } from './transpose';

const SCOPES: readonly { value: TransposeScope; label: string }[] = [
  { value: 'selection', label: 'Selection' },
  { value: 'track', label: 'Current track' },
  { value: 'song', label: 'All tracks' },
];

/**
 * Transposes by 24 semitones either way, over the selection, the current track or every track,
 * moving chord names and the key signature along when the scope allows. Applies as one undo
 * step; a note that would leave the neck keeps the dialog open with the sentence that names it.
 */
export function TransposeDialog({
  onClose,
  onCloseAutoFocus,
}: {
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const services = useAppServices();
  // The dialog is modal, so what is selected cannot change under it: read it once.
  const [initial] = useState(() => {
    const input = transposeInput(services);
    return {
      scope: input ? defaultScope(input) : 'track',
      amount: String(lastSemitones(services.document)),
      offers:
        input && Object.fromEntries(SCOPES.map(({ value }) => [value, scopeOffer(input, value)])),
      held: input && selectionCount(input),
    } as const;
  });
  const [scope, setScope] = useState<TransposeScope>(initial.scope);
  const [amount, setAmount] = useState<string>(initial.amount);
  const [chordNames, setChordNames] = useState(true);
  const [keySignature, setKeySignature] = useState(true);
  const [refusal, setRefusal] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<number>(undefined);
  const frame = useRef<number>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
      window.clearTimeout(pending.current);
    },
    [],
  );
  const ids = useId();
  const id = (field: string) => `${ids}-${field}`;

  const offer = initial.offers?.[scope];
  if (!offer) return null;
  const semitones = amount.trim() === '' ? Number.NaN : Number(amount);
  const error = semitoneError(semitones);
  const changed = () => {
    setRefusal(undefined);
  };

  const run = () => {
    const outcome = applyTranspose(
      services,
      {
        semitones,
        scope,
        chordNames: chordNames && offer.chordNames,
        keySignature: keySignature && offer.keySignature,
      },
      true,
    );
    if ('refused' in outcome) {
      setBusy(false);
      setRefusal(outcome.refused);
      return;
    }
    rememberSemitones(services.document, semitones);
    if ('nothing' in outcome)
      services.entry.getState().setMessage('There is nothing to transpose there');
    onClose();
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (error !== undefined || busy) return;
    // A whole-song transposition takes a while: show it working before the main thread is taken.
    setBusy(true);
    frame.current = window.requestAnimationFrame(() => {
      pending.current = window.setTimeout(run, 0);
    });
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
            <DialogTitle>Transpose</DialogTitle>
            <DialogDescription>
              Notes stay on their strings, so a note that would leave the neck stops the whole
              change.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <label htmlFor={id('amount')} className="text-xs font-medium">
              Semitones
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={id('amount')}
                type="number"
                inputMode="numeric"
                min={SEMITONES_MIN}
                max={SEMITONES_MAX}
                value={amount}
                aria-invalid={error !== undefined}
                aria-describedby={id('amount-label')}
                onChange={(event) => {
                  setAmount(event.target.value);
                  changed();
                }}
              />
              <span
                id={id('amount-label')}
                className="text-muted-foreground text-sm whitespace-nowrap"
              >
                {error === undefined ? semitoneLabel(semitones) : error}
              </span>
            </div>
          </div>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-xs font-medium">Apply to</legend>
            {SCOPES.map(({ value, label }) => {
              const disabled =
                value === 'selection' && initial.offers?.selection?.selection === false;
              return (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={id('scope')}
                    value={value}
                    checked={scope === value}
                    disabled={disabled}
                    onChange={() => {
                      setScope(value);
                      changed();
                    }}
                  />
                  {value === 'selection' && initial.held ? `${label} (${initial.held})` : label}
                </label>
              );
            })}
          </fieldset>
          <div className="grid gap-1">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={chordNames && offer.chordNames}
                disabled={!offer.chordNames}
                onChange={(event) => {
                  setChordNames(event.target.checked);
                  changed();
                }}
              />
              Transpose chord names
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={keySignature && offer.keySignature}
                disabled={!offer.keySignature}
                aria-describedby={offer.keySignature ? undefined : id('key-hint')}
                onChange={(event) => {
                  setKeySignature(event.target.checked);
                  changed();
                }}
              />
              Adjust the key signature
            </label>
            {!offer.keySignature && (
              <p id={id('key-hint')} className="text-muted-foreground text-xs">
                The key belongs to every track, so it moves only when all tracks are transposed.
              </p>
            )}
          </div>
          {refusal !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {refusal}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={error !== undefined || busy}>
              {busy ? 'Transposing…' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
