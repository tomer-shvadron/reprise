import type { Command } from '@/app/command-registry';
import type { Shortcut } from '@/app/keyboard';
import type { AppServices } from '@/app/services';

import {
  BEND_AMOUNTS,
  BEND_SHAPES,
  bendPreset,
  bendPresetLabel,
  type BendAmount,
  type BendShape,
} from './bend-presets';
import { commitEdit } from './commit';
import { planEffect, type EffectAction, type EffectMode } from './effects';
import { entryController } from './entry-controller';
import { visibleTracks } from './visible';
import {
  WHAMMY_AMOUNTS,
  WHAMMY_SHAPES,
  whammyPreset,
  type WhammyAmount,
  type WhammyShape,
} from './whammy-presets';

export type EffectServices = Pick<AppServices, 'document' | 'selection' | 'entry'>;

/**
 * Applies `action` to what the cursor, range or picked notes select, as one undo step under the
 * action's label. A refusal reads on the edit status line and changes nothing. The same path
 * serves the keys, the palette and, later, the panel, so they cannot drift apart. A digit still
 * waiting for its second figure is committed first, so "1, then P" mutes the note just entered.
 * Returns whether the score changed.
 */
export function runEffect(
  services: EffectServices,
  action: EffectAction,
  mode: EffectMode = 'toggle',
): boolean {
  const { document, selection, entry } = services;
  entryController(entry)?.flush();
  const { score, view } = document.getState();
  if (!score) return false;
  const plan = planEffect(
    { score, state: selection.getState(), visible: visibleTracks(score, view) },
    action,
    mode,
  );
  if ('refused' in plan) {
    entry.getState().setMessage(plan.refused);
    return false;
  }
  if (!('command' in plan)) return false;
  // The cursor stays where it is: an effect edits what is there, it does not move on.
  return commitEdit({ document, selection, entry }, plan.command, { moveCursor: false });
}

type Key = { key: string; shift?: boolean; mod?: boolean; alt?: boolean };

interface EffectKey {
  id: string;
  title: string;
  action: EffectAction;
  key?: Key;
  /** The same effect on the spelling a layout without Shift for it types; hidden from the palette. */
  alsoUnshifted?: boolean;
}

/**
 * Guitar Pro 8's keys for the effects that toggle. The punctuation ones need Shift on a US
 * keyboard and not on others, so both spellings are bound and only the shifted one is listed.
 */
const KEY_TABLE: readonly EffectKey[] = [
  {
    id: 'legatoSlide',
    title: 'Toggle legato slide',
    action: { kind: 'slide', slide: 'legato' },
    key: { key: 's' },
  },
  {
    id: 'hammerOn',
    title: 'Toggle hammer-on or pull-off',
    action: { kind: 'hammer' },
    key: { key: 'h' },
  },
  {
    id: 'vibrato',
    title: 'Toggle vibrato',
    action: { kind: 'vibrato', vibrato: 'slight' },
    key: { key: 'v' },
  },
  {
    id: 'wideVibrato',
    title: 'Toggle wide vibrato',
    action: { kind: 'vibrato', vibrato: 'wide' },
    key: { key: 'v', shift: true },
  },
  {
    id: 'palmMute',
    title: 'Toggle palm mute',
    action: { kind: 'flag', flag: 'palmMute' },
    key: { key: 'p' },
  },
  {
    id: 'palmMuteBeat',
    title: 'Toggle palm mute on the beat',
    action: { kind: 'flag', flag: 'palmMute', wholeBeat: true },
    key: { key: 'p', shift: true },
  },
  {
    id: 'letRing',
    title: 'Toggle let ring',
    action: { kind: 'flag', flag: 'letRing' },
    key: { key: 'i' },
  },
  {
    id: 'deadNote',
    title: 'Toggle dead note',
    action: { kind: 'flag', flag: 'dead' },
    key: { key: 'x' },
  },
  {
    id: 'ghostNote',
    title: 'Toggle ghost note',
    action: { kind: 'flag', flag: 'ghost' },
    key: { key: 'o' },
  },
  {
    id: 'accent',
    title: 'Toggle accent',
    action: { kind: 'accent', accent: 'accent' },
    key: { key: ';' },
  },
  {
    id: 'heavyAccent',
    title: 'Toggle heavy accent',
    action: { kind: 'accent', accent: 'heavy' },
    key: { key: ':', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'staccato',
    title: 'Toggle staccato',
    action: { kind: 'flag', flag: 'staccato' },
    key: { key: '!', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'naturalHarmonic',
    title: 'Toggle natural harmonic',
    action: { kind: 'harmonic', harmonic: { kind: 'natural' } },
    key: { key: 'y' },
  },
  {
    id: 'tremoloPicking',
    title: 'Toggle tremolo picking',
    action: { kind: 'tremolo', speed: 32 },
    key: { key: '"', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'tapping',
    title: 'Toggle tapping',
    action: { kind: 'beatFlag', flag: 'tapping' },
    key: { key: ')', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'slap',
    title: 'Toggle slap',
    action: { kind: 'beatFlag', flag: 'slapping' },
    key: { key: '$', shift: true },
    alsoUnshifted: true,
  },
  { id: 'pop', title: 'Toggle pop', action: { kind: 'beatFlag', flag: 'popping' } },
  {
    id: 'pickStrokeDown',
    title: 'Toggle pick stroke down',
    action: { kind: 'pickStroke', direction: 'down' },
    key: { key: 'd', shift: true },
  },
  {
    id: 'pickStrokeUp',
    title: 'Toggle pick stroke up',
    action: { kind: 'pickStroke', direction: 'up' },
    key: { key: 'u', shift: true },
  },
  {
    id: 'fadeIn',
    title: 'Toggle fade in',
    action: { kind: 'beatFlag', flag: 'fadeIn' },
    key: { key: '<', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'fadeOut',
    title: 'Toggle fade out',
    action: { kind: 'beatFlag', flag: 'fadeOut' },
    key: { key: '>', shift: true },
    alsoUnshifted: true,
  },
  {
    id: 'volumeSwell',
    title: 'Toggle volume swell',
    action: { kind: 'beatFlag', flag: 'volumeSwell' },
  },
  {
    id: 'whammyVibrato',
    title: 'Toggle whammy-bar vibrato',
    action: { kind: 'beatVibrato', vibrato: 'slight' },
    key: { key: 'w' },
  },
  {
    id: 'wideWhammyVibrato',
    title: 'Toggle wide whammy-bar vibrato',
    action: { kind: 'beatVibrato', vibrato: 'wide' },
    key: { key: 'w', alt: true },
  },
  {
    id: 'brushDown',
    title: 'Toggle brush down',
    action: { kind: 'brush', direction: 'down' },
    key: { key: 'd', mod: true },
  },
  {
    id: 'brushUp',
    title: 'Toggle brush up',
    action: { kind: 'brush', direction: 'up' },
    key: { key: 'u', mod: true },
  },
  {
    id: 'arpeggioDown',
    title: 'Toggle arpeggio down',
    action: { kind: 'arpeggio', direction: 'down' },
    key: { key: 'd', mod: true, shift: true },
  },
  {
    id: 'arpeggioUp',
    title: 'Toggle arpeggio up',
    action: { kind: 'arpeggio', direction: 'up' },
    key: { key: 'u', mod: true, shift: true },
  },
];

const KEYS: readonly EffectKey[] = KEY_TABLE.map((entry) => ({
  ...entry,
  id: `editor.effect.${entry.id}`,
}));

export type BendPresetId = `editor.effect.bend.${BendAmount}.${BendShape}`;
export type WhammyPresetId = `editor.effect.whammy.${WhammyAmount}.${WhammyShape}`;
export type EffectCommandId = `editor.effect.${string}` | BendPresetId | WhammyPresetId;

type EffectCommand = Command & { id: EffectCommandId };

const WHAMMY_AMOUNT_LABEL: Record<WhammyAmount, string> = {
  small: '½ step',
  medium: 'Whole step',
  large: '2 steps',
};
const WHAMMY_SHAPE_LABEL: Record<WhammyShape, string> = {
  dive: 'dive',
  dip: 'dip',
  releaseUp: 'release up',
};

const shortcutOf = (key: Key): Shortcut => ({
  key: key.key,
  ...(key.shift && { shift: true }),
  ...(key.mod && { mod: true }),
  ...(key.alt && { alt: true }),
});

/**
 * The effect keys of edit mode, and the bend and whammy presets as palette commands. Every one
 * is `context: 'editing'` and goes through `runEffect`, so outside edit mode no key does
 * anything, and a refusal reads on the status line. The picker keys (bend, slide kinds, harmonic
 * kinds, whammy) come with the panel.
 */
export function effectCommands(services: EffectServices): EffectCommand[] {
  const commands: EffectCommand[] = [];
  const add = (
    id: string,
    title: string,
    action: EffectAction,
    shortcut: Shortcut | undefined,
    inPalette: boolean,
  ) => {
    commands.push({
      id: id as EffectCommandId,
      title,
      ...(shortcut && { shortcut }),
      context: 'editing',
      repeat: false,
      inPalette,
      run: () => {
        runEffect(services, action);
      },
    });
  };
  for (const { id, title, action, key, alsoUnshifted } of KEYS) {
    add(id, title, action, key && shortcutOf(key), true);
    if (key && alsoUnshifted) {
      add(`${id}Unshifted`, title, action, shortcutOf({ key: key.key }), false);
    }
  }
  for (const amount of Object.keys(BEND_AMOUNTS) as BendAmount[]) {
    for (const shape of BEND_SHAPES) {
      const label = bendPresetLabel(shape, amount);
      add(
        `editor.effect.bend.${amount}.${shape}`,
        `Bend: ${label}`,
        { kind: 'bend', bend: bendPreset(shape, amount), label: label.toLowerCase() },
        undefined,
        true,
      );
    }
  }
  for (const amount of Object.keys(WHAMMY_AMOUNTS) as WhammyAmount[]) {
    for (const shape of WHAMMY_SHAPES) {
      const label = `${WHAMMY_AMOUNT_LABEL[amount]} ${WHAMMY_SHAPE_LABEL[shape]}`;
      add(
        `editor.effect.whammy.${amount}.${shape}`,
        `Whammy: ${label}`,
        {
          kind: 'whammy',
          whammy: whammyPreset(shape, amount),
          label: `whammy ${label.toLowerCase()}`,
        },
        undefined,
        true,
      );
    }
  }
  return commands;
}
