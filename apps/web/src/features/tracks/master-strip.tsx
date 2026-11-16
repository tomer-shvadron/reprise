import { useId } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const BYPASS_NOTE =
  'Leaves tracks on the General MIDI sounds without effects unless a track has its own preset.';

const percentText = (value: number) => `${String(Math.round(value))}%`;

/** The output level: the transport's master volume preference, not score data. */
export function MasterStrip() {
  const { playback, audio } = useAppServices();
  const volume = useStore(playback, (state) => state.settings.masterVolume);
  const gmTierBypass = useStore(playback, (state) => state.settings.gmTierBypass);
  const percent = volume * 100;
  const bypassId = useId();
  const noteId = useId();

  return (
    <div className="flex flex-col gap-1.5 border-t px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs font-medium">Master</span>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[percent]}
          thumbLabel="Master volume"
          valueText={percentText}
          onValueChange={([next]) => {
            if (next !== undefined) audio.setMasterVolume(next / 100);
          }}
        />
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {percentText(percent)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={bypassId}
          size="sm"
          checked={gmTierBypass}
          aria-describedby={noteId}
          onCheckedChange={(on) => {
            audio.setGmTierBypass(on);
          }}
        />
        <label htmlFor={bypassId} className="text-xs">
          No effects on GM sounds
        </label>
        <span id={noteId} className="sr-only">
          {BYPASS_NOTE}
        </span>
      </div>
    </div>
  );
}
