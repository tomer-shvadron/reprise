import { STANDARD_TUNINGS, type Id, type TrackKind } from '@reprise/model';
import { useId, useState, type SyntheticEvent } from 'react';
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
import { GM_DRUM_KITS, GM_FAMILIES, GM_PROGRAMS } from '@/features/tracks';

import { applyTrackAdd, applyTrackEdit } from './track-edit';
import {
  TRACK_COLORS,
  applyPreset,
  changeKind,
  formFromTrack,
  hasErrors,
  newTrackForm,
  noteLabel,
  presetNameOf,
  setName,
  setProgram,
  setShortName,
  setString,
  setStringCount,
  stringCountOptions,
  tuningNoteOptions,
  validateTrackForm,
  type TrackForm,
} from './track-form';

const KINDS: readonly { kind: TrackKind; label: string }[] = [
  { kind: 'fretted', label: 'Fretted' },
  { kind: 'drums', label: 'Drums' },
  { kind: 'pitched', label: 'Pitched' },
];

const SELECT_CLASS =
  'border-input bg-background h-8 w-full min-w-0 rounded-lg border px-2 text-sm aria-invalid:border-destructive';

const INSTRUMENTS = [
  ['guitar', 'Guitar'],
  ['bass', 'Bass'],
  ['ukulele', 'Ukulele'],
] as const;

function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  errorId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Adds a track, or edits one when `target` names it. The kind is chosen when adding and read-only
 * afterwards, as the model's `TrackChanges` has no `kind`. The dialog snapshots its track when it
 * opens, so the form never shifts under the typing.
 */
export function TrackDialog({
  target,
  onClose,
  onCloseAutoFocus,
}: {
  target: Id | undefined;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const services = useAppServices();
  const track = useStore(services.document, (state) =>
    state.score?.tracks.find(({ id }) => id === target),
  );
  const adding = target === undefined;
  const [form, setForm] = useState<TrackForm>(() =>
    track ? formFromTrack(track) : newTrackForm('fretted'),
  );
  const [refusal, setRefusal] = useState<string>();
  const ids = useId();
  const id = (field: string) => `${ids}-${field}`;

  const errors = validateTrackForm(form, track);
  const invalid = hasErrors(errors);
  const update = (next: TrackForm) => {
    setForm(next);
    setRefusal(undefined);
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (invalid) return;
    const result = adding ? applyTrackAdd(services, form) : applyTrackEdit(services, target, form);
    if (result.ok) onClose();
    else setRefusal(result.message);
  };

  const fretted = form.kind === 'fretted';
  const preset = presetNameOf(form);
  const kind = KINDS.find((entry) => entry.kind === form.kind)?.label;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        {...(onCloseAutoFocus && { onCloseAutoFocus })}
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{adding ? 'Add track' : 'Track properties'}</DialogTitle>
            <DialogDescription>
              {adding
                ? 'The new track gets an empty bar for every bar in the song.'
                : 'Changes apply together and undo in one step.'}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-1">
            <legend className="text-xs font-medium">Kind</legend>
            {adding ? (
              <div className="flex gap-4">
                {KINDS.map((entry) => (
                  <label key={entry.kind} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={id('kind')}
                      checked={form.kind === entry.kind}
                      onChange={() => {
                        update(changeKind(form, entry.kind));
                      }}
                    />
                    {entry.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm">
                {kind}{' '}
                <span className="text-muted-foreground text-xs">
                  Add a new track to change the kind
                </span>
              </p>
            )}
          </fieldset>

          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Field label="Name" htmlFor={id('name')} error={errors.name} errorId={id('name-error')}>
              <Input
                id={id('name')}
                autoFocus
                value={form.name}
                aria-invalid={errors.name !== undefined}
                aria-describedby={errors.name !== undefined ? id('name-error') : undefined}
                onChange={(event) => {
                  update(setName(form, event.target.value));
                }}
              />
            </Field>
            <Field
              label="Short name"
              htmlFor={id('short')}
              error={errors.shortName}
              errorId={id('short-error')}
            >
              <Input
                id={id('short')}
                value={form.shortName}
                aria-invalid={errors.shortName !== undefined}
                aria-describedby={errors.shortName !== undefined ? id('short-error') : undefined}
                onChange={(event) => {
                  update(setShortName(form, event.target.value));
                }}
              />
            </Field>
          </div>

          <fieldset className="grid gap-1">
            <legend className="text-xs font-medium">Colour</legend>
            <div className="flex flex-wrap items-center gap-2">
              {TRACK_COLORS.map((color) => (
                <input
                  key={color}
                  type="radio"
                  name={id('color')}
                  aria-label={`Colour ${color}`}
                  checked={form.color.toLowerCase() === color}
                  onChange={() => {
                    update({ ...form, color });
                  }}
                  className="ring-offset-background checked:ring-ring size-6 appearance-none rounded-full checked:ring-2 checked:ring-offset-2 focus-visible:ring-2"
                  style={{ backgroundColor: color }}
                />
              ))}
              <Input
                aria-label="Colour hex"
                className="w-24"
                value={form.color}
                aria-invalid={errors.color !== undefined}
                aria-describedby={errors.color !== undefined ? id('color-error') : undefined}
                onChange={(event) => {
                  update({ ...form, color: event.target.value });
                }}
              />
            </div>
            {errors.color !== undefined && (
              <p id={id('color-error')} className="text-destructive text-xs">
                {errors.color}
              </p>
            )}
          </fieldset>

          <Field label="Instrument" htmlFor={id('program')} errorId={id('program-error')}>
            <select
              id={id('program')}
              className={SELECT_CLASS}
              value={form.program}
              onChange={(event) => {
                update(setProgram(form, Number(event.target.value)));
              }}
            >
              {form.kind === 'drums' ? (
                <>
                  {!GM_DRUM_KITS.has(form.program) && (
                    <option value={form.program}>Kit {form.program}</option>
                  )}
                  {[...GM_DRUM_KITS].map(([program, name]) => (
                    <option key={program} value={program}>
                      {name}
                    </option>
                  ))}
                </>
              ) : (
                GM_FAMILIES.map((family, familyIndex) => (
                  <optgroup key={family} label={family}>
                    {GM_PROGRAMS.slice(familyIndex * 8, familyIndex * 8 + 8).map((name, offset) => (
                      <option key={name} value={familyIndex * 8 + offset}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          </Field>

          {fretted && (
            <fieldset className="grid gap-3">
              <legend className="text-xs font-medium">Strings and tuning</legend>
              <div className="grid grid-cols-3 gap-3">
                <Field
                  label="Strings"
                  htmlFor={id('count')}
                  error={errors.strings}
                  errorId={id('strings-error')}
                >
                  <select
                    id={id('count')}
                    className={SELECT_CLASS}
                    value={form.strings.length}
                    aria-invalid={errors.strings !== undefined}
                    aria-describedby={
                      errors.strings !== undefined ? id('strings-error') : undefined
                    }
                    onChange={(event) => {
                      update(setStringCount(form, Number(event.target.value)));
                    }}
                  >
                    {stringCountOptions(form.strings.length).map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tuning" htmlFor={id('preset')} errorId={id('preset-error')}>
                  <select
                    id={id('preset')}
                    className={SELECT_CLASS}
                    value={preset ?? ''}
                    onChange={(event) => {
                      update(applyPreset(form, event.target.value || undefined, adding));
                    }}
                  >
                    <option value="">Custom</option>
                    {INSTRUMENTS.map(([instrument, label]) => {
                      const presets = STANDARD_TUNINGS.filter(
                        (tuning) =>
                          tuning.instrument === instrument &&
                          tuning.strings.length === form.strings.length,
                      );
                      return presets.length === 0 ? null : (
                        <optgroup key={instrument} label={label}>
                          {presets.map(({ name }) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </Field>
                <Field
                  label="Capo"
                  htmlFor={id('capo')}
                  error={errors.capo}
                  errorId={id('capo-error')}
                >
                  <Input
                    id={id('capo')}
                    type="number"
                    inputMode="numeric"
                    value={form.capo}
                    aria-invalid={errors.capo !== undefined}
                    aria-describedby={errors.capo !== undefined ? id('capo-error') : undefined}
                    onChange={(event) => {
                      update({ ...form, capo: event.target.value });
                    }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {form.strings.map((pitch, index) => (
                  <Field
                    key={index}
                    label={`String ${String(index + 1)}`}
                    htmlFor={id(`string-${String(index + 1)}`)}
                    errorId={id(`string-${String(index + 1)}-error`)}
                  >
                    <select
                      id={id(`string-${String(index + 1)}`)}
                      className={SELECT_CLASS}
                      value={pitch}
                      onChange={(event) => {
                        update(setString(form, index + 1, Number(event.target.value)));
                      }}
                    >
                      {tuningNoteOptions(pitch).map((note) => (
                        <option key={note} value={note}>
                          {noteLabel(note)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              {!adding && (
                <p className="text-muted-foreground text-xs">
                  Changing the tuning keeps every fret, so the notes sound different.
                </p>
              )}
            </fieldset>
          )}

          {refusal !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {refusal}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid}>
              {adding ? 'Add track' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
