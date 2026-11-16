import { JUMP_LABELS } from '@reprise/layout';
import { ALTERNATE_ENDING_MAX, type Id } from '@reprise/model';
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';

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

import { applyMasterBarForm, dialogTarget } from './bar-actions';
import type { MasterBarSection } from './dialogs';
import {
  DENOMINATORS,
  ENDINGS,
  JUMP_KINDS,
  KEY_FIFTHS,
  PLAY_COUNT_RANGE,
  TEMPO_RANGE,
  edit,
  hasErrors,
  keyLabel,
  placementNote,
  validateMasterBarForm,
  type JumpChoice,
  type MasterBarForm,
} from './master-bar-form';

const SELECT_CLASS =
  'border-input bg-background h-8 w-full min-w-0 rounded-lg border px-2 text-sm aria-invalid:border-destructive';

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
  children: ReactNode;
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

function Check({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        {...(disabled !== undefined && { disabled })}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

/** Where a refusal belongs, so focus can go to that section's first field. */
function sectionOfRefusal(message: string): MasterBarSection | undefined {
  if (/time signature|allows/i.test(message)) return 'time';
  if (/ending|repeat/i.test(message)) return 'repeats';
  if (/tempo/i.test(message)) return 'tempo';
  return undefined;
}

/**
 * Edits the master bars of a target: one bar or a range. The dialog snapshots its bars when it
 * opens, writes only the fields the player touched, and applies them as one history step. A
 * refusal keeps it open with the model's sentence in an alert.
 */
export function MasterBarDialog({
  ids,
  focus,
  onClose,
  onCloseAutoFocus,
}: {
  ids: readonly Id[];
  focus?: MasterBarSection | undefined;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const services = useAppServices();
  const [snapshot] = useState(() => dialogTarget(services, ids));
  const [form, setForm] = useState<MasterBarForm | undefined>(snapshot?.form);
  const [refusal, setRefusal] = useState<string>();
  const ids_ = useId();
  const id = (field: string) => `${ids_}-${field}`;

  if (!snapshot || !form) return null;
  const { score, target, title } = snapshot;
  const note = placementNote(score, target);
  const errors = validateMasterBarForm(form);
  const invalid = hasErrors(errors);

  const update = (key: Parameters<typeof edit>[1], patch: Parameters<typeof edit>[2]) => {
    setForm(edit(form, key, patch));
    setRefusal(undefined);
  };

  const firstControl: Record<MasterBarSection, string> = {
    time: id('numerator'),
    key: id('key'),
    tempo: form.firstBar ? id('bpm') : id('tempo'),
    repeats: id('repeat-start'),
    directions: id('jump'),
    section: id('section-name'),
  };
  const focusSection = (section: MasterBarSection | undefined) => {
    document.getElementById(firstControl[section ?? 'time'])?.focus();
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (invalid) return;
    const result = applyMasterBarForm(services, ids, form);
    if (result.ok) {
      onClose();
      return;
    }
    setRefusal(result.message);
    // After the alert renders; the field lives in the dialog, which stays mounted.
    queueMicrotask(() => {
      focusSection(sectionOfRefusal(result.message));
    });
  };

  const jumpOptions: JumpChoice[] = ['', ...JUMP_KINDS];
  const toggleEnding = (ending: number) => {
    const next = form.endings.includes(ending)
      ? form.endings.filter((entry) => entry !== ending)
      : [...form.endings, ending].sort((a, b) => a - b);
    update('endings', { endings: next });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusSection(focus);
        }}
        {...(onCloseAutoFocus && { onCloseAutoFocus })}
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {note ?? 'Changes apply together and undo in one step.'}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-3">
            <legend className="text-xs font-medium">Time and key</legend>
            <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
              <Field
                label="Beats per bar"
                htmlFor={id('numerator')}
                error={errors.numerator}
                errorId={id('numerator-error')}
              >
                <Input
                  id={id('numerator')}
                  type="number"
                  inputMode="numeric"
                  placeholder={form.mixed.time ? 'Mixed' : ''}
                  value={form.time.numerator}
                  aria-invalid={errors.numerator !== undefined}
                  aria-describedby={
                    errors.numerator !== undefined ? id('numerator-error') : undefined
                  }
                  onChange={(event) => {
                    update('time', { time: { ...form.time, numerator: event.target.value } });
                  }}
                />
              </Field>
              <Field
                label="Beat length"
                htmlFor={id('denominator')}
                error={errors.denominator}
                errorId={id('denominator-error')}
              >
                <select
                  id={id('denominator')}
                  className={SELECT_CLASS}
                  value={form.time.denominator}
                  aria-invalid={errors.denominator !== undefined}
                  onChange={(event) => {
                    update('time', { time: { ...form.time, denominator: event.target.value } });
                  }}
                >
                  {form.mixed.time && <option value="">Mixed</option>}
                  {DENOMINATORS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <Field label="Key" htmlFor={id('key')} errorId={id('key-error')}>
                  <select
                    id={id('key')}
                    className={SELECT_CLASS}
                    value={form.mixed.key ? '' : form.key.fifths}
                    onChange={(event) => {
                      update('key', { key: { ...form.key, fifths: Number(event.target.value) } });
                    }}
                  >
                    {form.mixed.key && <option value="">Mixed</option>}
                    {KEY_FIFTHS.map((fifths) => (
                      <option key={fifths} value={fifths}>
                        {keyLabel(fifths, form.key.minor)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Mode" htmlFor={id('mode')} errorId={id('mode-error')}>
                  <select
                    id={id('mode')}
                    className={SELECT_CLASS}
                    value={form.key.minor ? 'minor' : 'major'}
                    onChange={(event) => {
                      update('key', {
                        key: { ...form.key, minor: event.target.value === 'minor' },
                      });
                    }}
                  >
                    <option value="major">Major</option>
                    <option value="minor">Minor</option>
                  </select>
                </Field>
              </div>
            </div>
            <Check
              id={id('continue')}
              label="Continue until the next change"
              checked={form.continueSignatures}
              onChange={(checked) => {
                setForm({ ...form, continueSignatures: checked });
              }}
            />
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium">Tempo</legend>
            <Check
              id={id('tempo')}
              label="Tempo change here"
              checked={form.tempo.on}
              disabled={form.firstBar}
              onChange={(checked) => {
                update('tempo', { tempo: { ...form.tempo, on: checked } });
              }}
            />
            {form.firstBar && (
              <p className="text-muted-foreground text-xs">The first bar always has a tempo</p>
            )}
            <Field
              label={`Beats per minute (${String(TEMPO_RANGE.min)} to ${String(TEMPO_RANGE.max)})`}
              htmlFor={id('bpm')}
              error={errors.tempo}
              errorId={id('bpm-error')}
            >
              <Input
                id={id('bpm')}
                type="number"
                inputMode="decimal"
                className="w-28"
                disabled={!form.tempo.on}
                value={form.tempo.bpm}
                aria-invalid={errors.tempo !== undefined}
                aria-describedby={errors.tempo !== undefined ? id('bpm-error') : undefined}
                onChange={(event) => {
                  update('tempo', { tempo: { ...form.tempo, bpm: event.target.value } });
                }}
              />
            </Field>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium">Repeats and endings</legend>
            <Check
              id={id('repeat-start')}
              label="Repeat start"
              checked={form.repeatStart}
              onChange={(checked) => {
                update('repeatStart', { repeatStart: checked });
              }}
            />
            <div className="flex items-end gap-3">
              <Check
                id={id('repeat-end')}
                label="Repeat end"
                checked={form.repeatEnd.on}
                onChange={(checked) => {
                  update('repeatEnd', { repeatEnd: { ...form.repeatEnd, on: checked } });
                }}
              />
              <Field
                label="Play count"
                htmlFor={id('count')}
                error={errors.count}
                errorId={id('count-error')}
              >
                <Input
                  id={id('count')}
                  type="number"
                  inputMode="numeric"
                  className="w-20"
                  min={PLAY_COUNT_RANGE.min}
                  disabled={!form.repeatEnd.on}
                  value={form.repeatEnd.count}
                  aria-invalid={errors.count !== undefined}
                  aria-describedby={errors.count !== undefined ? id('count-error') : undefined}
                  onChange={(event) => {
                    update('repeatEnd', {
                      repeatEnd: { ...form.repeatEnd, count: event.target.value },
                    });
                  }}
                />
              </Field>
            </div>
            <div role="group" aria-label="Alternate endings" className="flex flex-wrap gap-1.5">
              {ENDINGS.slice(0, ALTERNATE_ENDING_MAX).map((ending) => (
                <Button
                  key={ending}
                  type="button"
                  size="sm"
                  variant={form.endings.includes(ending) ? 'default' : 'outline'}
                  aria-pressed={form.endings.includes(ending)}
                  aria-label={`Ending ${String(ending)}`}
                  onClick={() => {
                    toggleEnding(ending);
                  }}
                >
                  {ending}
                </Button>
              ))}
              {form.mixed.endings && (
                <span className="text-muted-foreground self-center text-xs">Mixed</span>
              )}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium">Directions</legend>
            <Field label="Jump" htmlFor={id('jump')} errorId={id('jump-error')}>
              <select
                id={id('jump')}
                className={SELECT_CLASS}
                value={form.jump}
                onChange={(event) => {
                  // The select's values are `JUMP_KINDS` or '', as its options are built from them.
                  const value = jumpOptions.find((option) => option === event.target.value);
                  if (value !== undefined) update('jump', { jump: value });
                }}
              >
                <option value="">None</option>
                {form.jump === 'several' && <option value="several">Several (unchanged)</option>}
                {JUMP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {JUMP_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Check
                id={id('segno')}
                label="Segno"
                checked={form.segno}
                onChange={(checked) => {
                  update('segno', { segno: checked });
                }}
              />
              <Check
                id={id('segno-segno')}
                label="Segno Segno"
                checked={form.segnoSegno}
                onChange={(checked) => {
                  update('segnoSegno', { segnoSegno: checked });
                }}
              />
              <Check
                id={id('coda')}
                label="Coda"
                checked={form.coda}
                onChange={(checked) => {
                  update('coda', { coda: checked });
                }}
              />
              <Check
                id={id('double-coda')}
                label="Double Coda"
                checked={form.doubleCoda}
                onChange={(checked) => {
                  update('doubleCoda', { doubleCoda: checked });
                }}
              />
              <Check
                id={id('fine')}
                label="Fine"
                checked={form.fine}
                onChange={(checked) => {
                  update('fine', { fine: checked });
                }}
              />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-[2fr_1fr] gap-3">
            <legend className="text-xs font-medium">Section</legend>
            <Field label="Section name" htmlFor={id('section-name')} errorId={id('section-error')}>
              <Input
                id={id('section-name')}
                value={form.section.name}
                onChange={(event) => {
                  update('section', { section: { ...form.section, name: event.target.value } });
                }}
              />
            </Field>
            <Field label="Letter" htmlFor={id('section-letter')} errorId={id('letter-error')}>
              <Input
                id={id('section-letter')}
                value={form.section.letter}
                onChange={(event) => {
                  update('section', { section: { ...form.section, letter: event.target.value } });
                }}
              />
            </Field>
          </fieldset>

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
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
