import type { EffectKeyName, EffectPicker } from '@/features/editor';
import type { BarRange } from '@/state/selection';

import type { CommandRegistry } from '../command-registry';
import type { MenuRegistry } from '../context-menu/menu-registry';
import { resolveItems } from '../context-menu/resolve-menu';
import {
  SURFACE_PARENTS,
  type MenuContext,
  type MenuMode,
  type MenuSurface,
} from '../context-menu/types';
import type { KeyboardPlatform } from '../keyboard';
import type { RegisteredCommandId } from '../use-command';

/** One button of the pill: a command and the short word it shows. Its name is the menu item's label. */
export interface PillItemSpec {
  key: string;
  command: RegisteredCommandId;
  /**
   * What the button is. A plain `command` runs it; `duration` opens the status bar's duration
   * menu (its steps are `also`); `rhythm` is a toggle pressed from the entry rhythm; `effect` a
   * toggle pressed from the effect state; `picker` opens a dialog.
   */
  kind?: 'command' | 'duration' | 'rhythm' | 'effect' | 'picker';
  /** The effect an `effect` item toggles. */
  effect?: EffectKeyName;
  /** The dialog a `picker` item opens. */
  picker?: EffectPicker;
  /** Other commands the item stands for, which the startup check also finds on the surface. */
  also?: readonly RegisteredCommandId[];
  /** Run instead of `command` while the button is pressed (Loop turns an active loop off). */
  pressedCommand?: RegisteredCommandId;
  /** The visible word; the accessible name (the menu's label) contains it, as WCAG 2.5.3 asks. */
  text: string;
}

/**
 * The items one pill mirrors, and the menu surface and mode they mirror. Nothing here is a
 * command of its own: the pill is a view of the menu's items, which are the source.
 */
export interface PillSpec {
  surface: MenuSurface;
  mode: MenuMode;
  items: readonly PillItemSpec[];
}

/** The pill over a bar range in play mode (practice mode included). */
export const PLAY_PILL: PillSpec = {
  surface: 'score.range',
  mode: 'play',
  items: [
    {
      key: 'loop',
      command: 'transport.loopSelection',
      pressedCommand: 'transport.toggleLoop',
      text: 'Loop',
    },
    { key: 'trainer', command: 'trainer.speedTrainerOnSelection', text: 'Trainer' },
    { key: 'focus', command: 'view.focusOnLoop', text: 'Focus' },
    { key: 'copy', command: 'editor.copyBars', text: 'Copy' },
  ],
};

/**
 * The pill over the edit cursor or range. Its items are the score note menu's, which carries the
 * beat's and the bar's: the menu itself resolves to the surface of what is under the cursor, the
 * pill always asks the richest one and each command's own `enabled` decides.
 */
export const EDIT_PILL: PillSpec = {
  surface: 'score.note',
  mode: 'edit',
  items: [
    {
      key: 'duration',
      kind: 'duration',
      command: 'editor.durationLonger',
      also: ['editor.durationShorter'],
      text: 'Duration',
    },
    { key: 'dot', kind: 'rhythm', command: 'editor.toggleDot', text: 'Dot' },
    { key: 'triplet', kind: 'rhythm', command: 'editor.toggleTriplet', text: 'Triplet' },
    {
      key: 'hammerOn',
      kind: 'effect',
      effect: 'hammerOn',
      command: 'editor.effect.hammerOn',
      text: 'H',
    },
    {
      key: 'legatoSlide',
      kind: 'effect',
      effect: 'legatoSlide',
      command: 'editor.effect.legatoSlide',
      text: 'S',
    },
    { key: 'bend', kind: 'picker', picker: 'bend', command: 'editor.effect.bendPicker', text: 'B' },
    {
      key: 'vibrato',
      kind: 'effect',
      effect: 'vibrato',
      command: 'editor.effect.vibrato',
      text: 'V',
    },
    {
      key: 'palmMute',
      kind: 'effect',
      effect: 'palmMute',
      command: 'editor.effect.palmMute',
      text: 'P',
    },
  ],
};

export const PILLS: readonly PillSpec[] = [PLAY_PILL, EDIT_PILL];

/** The effect toggles and the picker the edit pill shows, for the effect state's `only`. */
export const EDIT_PILL_ONLY = {
  toggles: ['hammerOn', 'legatoSlide', 'vibrato', 'palmMute'],
  pickers: ['bend'],
} as const;

/**
 * Throws at startup when a pill item's command is not an item of its surface, or of a parent
 * level, in the pill's mode, or when its `pressedCommand` is not registered: removing a menu item
 * then forces a change to the pill, never a button that silently does something else.
 */
export function checkPillItems(
  menus: MenuRegistry,
  registry: CommandRegistry,
  pills: readonly PillSpec[] = PILLS,
): void {
  for (const { surface, mode, items } of pills) {
    const levels = [surface, ...(SURFACE_PARENTS[surface] ?? [])];
    for (const { command, also = [], pressedCommand } of items) {
      for (const each of [command, ...also]) {
        const offered = levels.some((level) =>
          menus
            .itemsOf(level)
            .some((item) => item.commands.includes(each) && item.modes.includes(mode)),
        );
        if (!offered) {
          throw new Error(
            `The selection pill mirrors "${each}", which the ${surface} menu does not offer in ${mode} mode`,
          );
        }
      }
      if (pressedCommand !== undefined && !registry.get(pressedCommand)) {
        throw new Error(`The selection pill names unknown command "${pressedCommand}"`);
      }
    }
  }
}

export interface ResolvedPillItem {
  spec: PillItemSpec;
  /** The menu's label: the accessible name and the tooltip's text. */
  label: string;
  enabled: boolean;
}

/** The pill's items as the menu resolves them now: an item the menu drops here is dropped too. */
export function resolvePillItems(
  menus: MenuRegistry,
  registry: CommandRegistry,
  pill: PillSpec,
  at: MenuContext,
  keyboard: KeyboardPlatform,
): ResolvedPillItem[] {
  const resolved = resolveItems(
    menus,
    registry,
    pill.surface,
    at,
    keyboard,
    pill.items.map((item) => item.command),
  );
  return pill.items.flatMap((spec) => {
    const found = resolved.find((item) => item.id === spec.command);
    return found ? [{ spec, label: found.label, enabled: found.enabled }] : [];
  });
}

/** Loop is pressed while the loop is exactly the selected bars. */
export function loopPressed(loop: BarRange | undefined, bars: BarRange | undefined): boolean {
  return (
    loop !== undefined &&
    bars !== undefined &&
    loop.startBar === bars.startBar &&
    loop.endBar === bars.endBar
  );
}
