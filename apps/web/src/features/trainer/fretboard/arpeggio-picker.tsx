import { useState, type Ref } from 'react';
import { useStore } from 'zustand';

import { HintTooltip } from '@/app/command-tooltip';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

import { arpeggioOf } from './arpeggio-dots';
import type { ArpeggioOverlayStore } from './arpeggio-overlay';
import { TONICS } from './scale-picker';

/** The qualities worth a button: the chart's suffix, and a label that reads. */
const QUALITIES: readonly { suffix: string; label: string }[] = [
  { suffix: '', label: 'major' },
  { suffix: 'm', label: 'm' },
  { suffix: '7', label: '7' },
  { suffix: 'maj7', label: 'maj7' },
  { suffix: 'm7', label: 'm7' },
  { suffix: 'm7b5', label: 'm7♭5' },
  { suffix: 'dim7', label: 'dim7' },
  { suffix: 'aug', label: 'aug' },
  { suffix: 'sus2', label: 'sus2' },
  { suffix: 'sus4', label: 'sus4' },
  { suffix: '6', label: '6' },
  { suffix: 'm6', label: 'm6' },
  { suffix: '9', label: '9' },
  { suffix: 'add9', label: 'add9' },
];
const DEFAULT_ROOT = 9;
const DEFAULT_SUFFIX = 'm';

const intervalsOf = (name: string): string | undefined => arpeggioOf(name)?.intervals.join(',');

/** The button a chord's intervals belong to, built once: a quality with no button has no entry. */
const SUFFIX_OF = new Map(
  QUALITIES.flatMap(({ suffix }) => {
    const key = intervalsOf(`C${suffix}`);
    return key === undefined ? [] : [[key, suffix] as const];
  }),
);

/** Picks are held in the chord library's own spelling (`F#m7b5`, `Bb7`); the buttons show ♭ and ♯. */
const asciiRoot = (name: string): string => name.replace('♯', '#').replace('♭', 'b');

/**
 * The arpeggio tool: whether the chord follows the song, the labels, and a root and quality to
 * hold. It lives in the fretboard's header beside the scale's, so no other view is needed.
 */
export function ArpeggioPicker({
  store,
  triggerRef,
}: {
  store: ArpeggioOverlayStore;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<number | undefined>(undefined);
  const [suffix, setSuffix] = useState<string | undefined>(undefined);
  const follow = useStore(store, (state) => state.follow);
  const labels = useStore(store, (state) => state.labels);
  const shown = useStore(store, (state) => state.shown);
  const on = useStore(store, (state) => state.on);
  // Only the chord on the neck is pressed, and only as far as a button stands for it: a power
  // chord presses its root and no quality, and no chord presses nothing. The last pick is kept
  // apart, as what the next click starts from.
  const current = on && shown.kind === 'chord' ? arpeggioOf(shown.name) : undefined;
  const pressedRoot = current?.root;
  const pressedSuffix = current ? SUFFIX_OF.get(current.intervals.join(',')) : undefined;
  const fillRoot = pressedRoot ?? root ?? DEFAULT_ROOT;
  const fillSuffix = pressedSuffix ?? suffix ?? DEFAULT_SUFFIX;
  const pick = (nextRoot: number, nextSuffix: string) => {
    setRoot(nextRoot);
    setSuffix(nextSuffix);
    store.getState().hold(`${asciiRoot(TONICS[nextRoot] ?? 'A')}${nextSuffix}`);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Mark a chord's tones on the neck">
        <PopoverTrigger asChild>
          <Button ref={triggerRef} variant="outline" size="xs" aria-label="Choose an arpeggio">
            Arpeggio…
          </Button>
        </PopoverTrigger>
      </HintTooltip>
      <PopoverContent align="end" className="w-80" aria-label="Arpeggio tool" data-arpeggio-picker>
        <label className="flex items-center justify-between gap-2 text-sm">
          Follow chord changes
          <Switch
            size="sm"
            checked={follow}
            onCheckedChange={(checked) => {
              store.getState().setFollow(checked);
            }}
          />
        </label>
        <div role="group" aria-label="Labels" className="grid grid-cols-2 gap-1">
          {(
            [
              ['degree', 'Degrees'],
              ['name', 'Notes'],
            ] as const
          ).map(([value, text]) => (
            <Button
              key={value}
              variant={labels === value ? 'default' : 'outline'}
              size="xs"
              aria-pressed={labels === value}
              onClick={() => {
                store.getState().setLabels(value);
              }}
            >
              {text}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Chord root" className="grid grid-cols-6 gap-1">
          {TONICS.map((name, pitchClass) => (
            <Button
              key={name}
              variant={pressedRoot === pitchClass ? 'default' : 'outline'}
              size="xs"
              aria-pressed={pressedRoot === pitchClass}
              onClick={() => {
                pick(pitchClass, fillSuffix);
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Chord quality" className="grid grid-cols-4 gap-1">
          {QUALITIES.map((entry) => (
            <Button
              key={entry.label}
              variant={pressedSuffix === entry.suffix ? 'default' : 'outline'}
              size="xs"
              aria-pressed={pressedSuffix === entry.suffix}
              onClick={() => {
                pick(fillRoot, entry.suffix);
              }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
