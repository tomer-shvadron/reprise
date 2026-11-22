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
  // What is on the neck wins, as in the scale picker: the buttons show the chord drawn and the
  // next pick changes it; the last pick only fills in while no chord is shown.
  const current = on && shown.kind === 'chord' ? arpeggioOf(shown.name) : undefined;
  const shownRoot = current?.root ?? root ?? DEFAULT_ROOT;
  const shownSuffix =
    (current
      ? QUALITIES.find((entry) => intervalsOf(`C${entry.suffix}`) === current.intervals.join(','))
          ?.suffix
      : undefined) ??
    suffix ??
    DEFAULT_SUFFIX;
  const pick = (nextRoot: number, nextSuffix: string) => {
    setRoot(nextRoot);
    setSuffix(nextSuffix);
    store.getState().hold(`${TONICS[nextRoot] ?? 'A'}${nextSuffix}`);
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
              variant={shownRoot === pitchClass ? 'default' : 'outline'}
              size="xs"
              aria-pressed={shownRoot === pitchClass}
              onClick={() => {
                pick(pitchClass, shownSuffix);
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
              variant={shownSuffix === entry.suffix ? 'default' : 'outline'}
              size="xs"
              aria-pressed={shownSuffix === entry.suffix}
              onClick={() => {
                pick(shownRoot, entry.suffix);
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
