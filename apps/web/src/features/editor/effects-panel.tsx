import { cn } from 'cn';
import { useEffect, useId, useRef, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { focusPanelSection } from '@/app/right-panel';
import { CommandTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import { toggleVariants } from '@/components/ui/toggle';

import type { EffectPicker } from './dialogs';
import type { EffectKeyName } from './effect-commands';
import type { Known, PanelState } from './panel-state';
import { pressedOf, useEffectPanelState, usePickerOpener } from './use-effect-controls';

/** A click must not take focus from the page: typing frets carries on after it. */
const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};

// The label wraps (toggleVariants says nowrap and a fixed height) so it never spills into the next
// button at the panel's narrow widths.
const BUTTON_CLASS = cn(
  toggleVariants({ variant: 'outline', size: 'sm' }),
  'h-auto min-h-7 w-full justify-start py-1 text-left whitespace-normal aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:bg-muted/50',
);

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
  { picker: 'trill', label: 'Trill…' },
  { picker: 'dynamics', label: 'Dynamics…' },
];

const BEAT_ITEMS: readonly Item[] = [
  { picker: 'grace', label: 'Grace note…' },
  { toggle: 'tremoloPicking', label: 'Tremolo picking' },
  { picker: 'tremolo', label: 'Tremolo speed…' },
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
  trill: 'editor.effect.trillPicker',
  tremolo: 'editor.effect.tremoloPicker',
  dynamics: 'editor.effect.dynamicsPicker',
  grace: 'editor.effect.grace',
};

/** An effect that toggles: pressed, not pressed or mixed from the selection, run as its key does. */
function EffectToggle({
  item,
  known,
  disabled,
}: {
  item: ToggleItem;
  known: Known | undefined;
  disabled: boolean;
}) {
  const bound = useCommand(`editor.effect.${item.toggle}`);
  const state = known?.state ?? 'unavailable';
  return (
    <CommandTooltip
      command={`editor.effect.${item.toggle}`}
      label={item.label}
      whenUnbound="none"
      reason={known?.reason}
      wrapped
    >
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-pressed={pressedOf(state)}
        disabled={disabled || state === 'unavailable'}
        onMouseDown={keepFocus}
        onClick={bound.run}
      >
        {item.label}
      </button>
    </CommandTooltip>
  );
}

/**
 * An effect that asks first: opens its dialog. From the keyboard focus comes back to this button;
 * after a click it stays with the page (the click never took it), so Space and Enter keep their
 * meaning there.
 */
function EffectOpener({
  item,
  disabled,
  blocked,
}: {
  item: PickerItem;
  disabled: boolean;
  blocked: string | undefined;
}) {
  const open = usePickerOpener(item.picker);
  return (
    <CommandTooltip
      command={PICKER_COMMAND[item.picker]}
      label={item.label.replace('…', '')}
      whenUnbound="none"
      reason={blocked}
      wrapped
    >
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-haspopup="dialog"
        disabled={disabled || blocked !== undefined}
        onMouseDown={keepFocus}
        onClick={open}
      >
        {item.label}
      </button>
    </CommandTooltip>
  );
}

function Group({
  title,
  items,
  known,
  disabled,
  blockers,
}: {
  title: string;
  items: readonly Item[];
  known: Map<EffectKeyName, Known>;
  disabled: boolean;
  blockers: PanelState['blockers'];
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
              known={known.get(item.toggle)}
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
  const { document, editing } = services;
  const isEditing = useStore(editing, (state) => state.editing);
  const score = useStore(document, (state) => state.score);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  const editKey = useCommand('editor.toggleMode').keys;

  // Opening the panel puts the next Tab on its first control.
  useEffect(() => {
    focusPanelSection(section.current, services.ui);
  }, [services.ui]);

  const { known, blockers, empty } = useEffectPanelState();

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
          known={known}
          disabled={disabled}
          blockers={blockers}
        />
        <Group
          title="Beat"
          items={BEAT_ITEMS}
          known={known}
          disabled={disabled}
          blockers={blockers}
        />
      </div>
    </section>
  );
}
