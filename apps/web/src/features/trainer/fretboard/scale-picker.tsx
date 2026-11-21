import { useState } from 'react';

import { HintTooltip } from '@/app/command-tooltip';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SCALES, type ScaleId } from '@/lib/insights';
import { cn } from 'cn';

import type { ScaleOverlayStore } from './scale-overlay';

/** Flats for the black keys: the picker names a tonic, and the scale's own spelling follows it. */
const TONICS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
const DEFAULT_TONIC = 9;
const DEFAULT_SCALE: ScaleId = 'minorPentatonic';

/**
 * The scale tool: a tonic and a scale, either of which marks the neck at once. It lives in the
 * fretboard's header beside the overlay chip, so no other view is needed.
 */
export function ScalePicker({ store }: { store: ScaleOverlayStore }) {
  const [open, setOpen] = useState(false);
  const [tonic, setTonic] = useState<number | undefined>(undefined);
  const [scale, setScale] = useState<ScaleId | undefined>(undefined);
  const current = store.getState().overlay;
  // What the buttons show as chosen: the player's last pick, else what the neck shows now.
  const shownTonic = tonic ?? current?.tonic ?? DEFAULT_TONIC;
  const shownScale = scale ?? current?.scaleId ?? DEFAULT_SCALE;
  const pick = (nextTonic: number, nextScale: ScaleId) => {
    setTonic(nextTonic);
    setScale(nextScale);
    store.getState().show(nextTonic, nextScale, 'manual');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Choose a tonic and a scale to mark on the neck">
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" aria-label="Choose a scale">
            Scale…
          </Button>
        </PopoverTrigger>
      </HintTooltip>
      <PopoverContent align="end" className="w-80" data-scale-picker>
        <div role="group" aria-label="Tonic" className="grid grid-cols-6 gap-1">
          {TONICS.map((name, pitchClass) => (
            <Button
              key={name}
              variant={shownTonic === pitchClass ? 'default' : 'outline'}
              size="xs"
              aria-pressed={shownTonic === pitchClass}
              onClick={() => {
                pick(pitchClass, shownScale);
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Scale" className="grid grid-cols-2 gap-1">
          {SCALES.map((entry) => (
            <Button
              key={entry.id}
              variant={shownScale === entry.id ? 'default' : 'outline'}
              size="xs"
              aria-pressed={shownScale === entry.id}
              className={cn('justify-start truncate')}
              onClick={() => {
                pick(shownTonic, entry.id);
              }}
            >
              {entry.name}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
