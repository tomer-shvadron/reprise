import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Slider } from '@/components/ui/slider';

const percentText = (value: number) => `${String(Math.round(value))}%`;

/** The output level: the transport's master volume preference, not score data. */
export function MasterStrip() {
  const { playback, audio } = useAppServices();
  const volume = useStore(playback, (state) => state.settings.masterVolume);
  const percent = volume * 100;

  return (
    <div className="flex items-center gap-2 border-t px-3 py-2">
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
  );
}
