import { useEffect, useId, useMemo, useRef, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import { toggleVariants } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { EffectPicker } from './dialogs';
import { EFFECT_KEY_TABLE, type EffectKeyName } from './effect-commands';
import { effectInput, openEffectPicker, openGraceDialog, pickerBlocker } from './effect-dialogs';
import { effectState, type EffectState } from './effect-state';
import { graceBlocker } from './grace-form';

/** A click must not take focus from the page: typing frets carries on after it. */
const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};

const BUTTON_CLASS = `${toggleVariants({ variant: 'outline', size: 'sm' })} aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:bg-muted/50 justify-start`;

type ToggleItem = { toggle: EffectKeyName; label: string };
type PickerItem = { picker: EffectPicker | 'grace'; label: string };
type Item = ToggleItem | PickerItem;

const NOTE_ITEMS: readonly Item[] = [
  { picker: 'bend', label: 'Bend…' },
  { picker: 'slide', label: 'Slide…' },
  { toggle: 'hammerOn', label: 'Hammer-on or pull-off' },
  { toggle: 'vibrato', label: 'Vibrato' },
  { toggle: 'wideVibrato', label: 'Wide vibrato' },
  { toggle: 'palmMute', label: 'Palm mute' },
  { toggle: 'letRing', label: 'Let ring' },
  { toggle: 'deadNote', label: 'Dead note' },
  { toggle: 'ghostNote', label: 'Ghost note' },
  { toggle: 'accent', label: 'Accent' },
  { toggle: 'heavyAccent', label: 'Heavy accent' },
  { toggle: 'staccato', label: 'Staccato' },
  { toggle: 'naturalHarmonic', label: 'Natural harmonic' },
  { picker: 'harmonic', label: 'Harmonic…' },
];

const BEAT_ITEMS: readonly Item[] = [
  { picker: 'grace', label: 'Grace note…' },
  { toggle: 'tremoloPicking', label: 'Tremolo picking' },
  { toggle: 'tapping', label: 'Tapping' },
  { toggle: 'slap', label: 'Slap' },
  { toggle: 'pop', label: 'Pop' },
  { toggle: 'pickStrokeDown', label: 'Pick stroke down' },
  { toggle: 'pickStrokeUp', label: 'Pick stroke up' },
  { toggle: 'fadeIn', label: 'Fade in' },
  { toggle: 'fadeOut', label: 'Fade out' },
  { toggle: 'volumeSwell', label: 'Volume swell' },
  { toggle: 'whammyVibrato', label: 'Whammy-bar vibrato' },
  { toggle: 'wideWhammyVibrato', label: 'Wide whammy-bar vibrato' },
  { picker: 'whammy', label: 'Whammy bar…' },
  { toggle: 'brushDown', label: 'Brush down' },
  { toggle: 'brushUp', label: 'Brush up' },
  { toggle: 'arpeggioDown', label: 'Arpeggio down' },
  { toggle: 'arpeggioUp', label: 'Arpeggio up' },
];

const PICKER_COMMAND: Record<EffectPicker | 'grace', RegisteredCommandId> = {
  bend: 'editor.effect.bendPicker',
  slide: 'editor.effect.slidePicker',
  harmonic: 'editor.effect.harmonicPicker',
  whammy: 'editor.effect.whammyPicker',
  grace: 'editor.effect.grace',
};

const pressedOf = (state: EffectState): boolean | 'mixed' | undefined =>
  state === 'on' ? true : state === 'mixed' ? 'mixed' : false;

function Tip({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

const tipText = (label: string, keys: string | undefined) => (keys ? `${label} (${keys})` : label);

/** An effect that toggles: pressed, not pressed or mixed from the selection, run as its key does. */
function EffectToggle({
  item,
  state,
  disabled,
}: {
  item: ToggleItem;
  state: EffectState;
  disabled: boolean;
}) {
  const bound = useCommand(`editor.effect.${item.toggle}`);
  return (
    <Tip text={tipText(item.label, bound.keys)}>
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-pressed={pressedOf(state)}
        aria-keyshortcuts={bound.ariaKeys}
        disabled={disabled || state === 'unavailable'}
        onMouseDown={keepFocus}
        onClick={bound.run}
      >
        {item.label}
      </button>
    </Tip>
  );
}

/** An effect that asks first: opens its dialog, and focus comes back here when it closes. */
function EffectOpener({
  item,
  disabled,
  blocked,
}: {
  item: PickerItem;
  disabled: boolean;
  blocked: boolean;
}) {
  const services = useAppServices();
  const bound = useCommand(PICKER_COMMAND[item.picker]);
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    const from = event.currentTarget;
    if (item.picker === 'grace') openGraceDialog(services, true, from);
    else openEffectPicker(services, item.picker, from);
  };
  return (
    <Tip text={tipText(item.label.replace('…', ''), bound.keys)}>
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-haspopup="dialog"
        aria-keyshortcuts={bound.ariaKeys}
        disabled={disabled || blocked}
        onMouseDown={keepFocus}
        onClick={open}
      >
        {item.label}
      </button>
    </Tip>
  );
}

function Group({
  title,
  items,
  states,
  disabled,
  blockers,
}: {
  title: string;
  items: readonly Item[];
  states: Map<EffectKeyName, EffectState>;
  disabled: boolean;
  blockers: Record<EffectPicker | 'grace', boolean>;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-1.5">
      <h3 id={headingId} className="text-muted-foreground text-xs font-medium">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) =>
          'toggle' in item ? (
            <EffectToggle
              key={item.toggle}
              item={item}
              state={states.get(item.toggle) ?? 'unavailable'}
              disabled={disabled}
            />
          ) : (
            <EffectOpener
              key={item.picker}
              item={item}
              disabled={disabled}
              blocked={blockers[item.picker]}
            />
          ),
        )}
      </div>
    </section>
  );
}

/**
 * The right panel's effects: every effect as a button with its state read from the selection (on,
 * off, or mixed when the notes disagree, which a press sets on all). A press runs the registry
 * command its key runs, so the panel, the keys and the palette cannot drift; the effects that ask
 * first open their dialog. Everything is disabled outside edit mode and where the selection cannot
 * take the effect.
 */
export function EffectsPanel() {
  const services = useAppServices();
  const { document, selection, editing } = services;
  const isEditing = useStore(editing, (state) => state.editing);
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const state = useStore(selection);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  const editKey = useCommand('editor.toggleMode').keys;

  // Opening the panel puts the next Tab on its first control.
  useEffect(() => {
    section.current?.focus();
  }, []);

  const { states, blockers, empty } = useMemo(() => {
    const input = effectInput(services);
    const computed = new Map<EffectKeyName, EffectState>();
    if (input && isEditing) {
      for (const { id, action } of EFFECT_KEY_TABLE) computed.set(id, effectState(input, action));
    }
    const blocked = (picker: EffectPicker) =>
      !input || pickerBlocker(services, picker) !== undefined;
    return {
      states: computed,
      blockers: {
        bend: blocked('bend'),
        slide: blocked('slide'),
        harmonic: blocked('harmonic'),
        whammy: blocked('whammy'),
        grace: !input || graceBlocker(input) !== undefined,
      },
      empty: !input || [...computed.values()].every((value) => value === 'unavailable'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores' state is the dependency
  }, [services, isEditing, score, view, state]);

  const disabled = !isEditing || !score;
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <h2
        id={headingId}
        className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase"
      >
        Effects
      </h2>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto border-t px-3 py-3">
        {!score ? (
          <p className="text-muted-foreground text-sm">Open a file to edit its effects.</p>
        ) : !isEditing ? (
          <p className="text-muted-foreground text-sm">
            {`Turn on edit mode${editKey ? ` (${editKey})` : ''} to apply effects`}
          </p>
        ) : empty ? (
          <p className="text-muted-foreground text-sm">Select a note to apply effects.</p>
        ) : null}
        <Group
          title="Note"
          items={NOTE_ITEMS}
          states={states}
          disabled={disabled}
          blockers={blockers}
        />
        <Group
          title="Beat"
          items={BEAT_ITEMS}
          states={states}
          disabled={disabled}
          blockers={blockers}
        />
      </div>
    </section>
  );
}
