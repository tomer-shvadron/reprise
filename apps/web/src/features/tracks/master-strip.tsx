import { useId } from 'react';
import { useStore } from 'zustand';

import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useAppServices } from '@/app/services-context';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const CHANNEL_NOTE = 'GM sounds only.';
const BYPASS_NOTE = 'A track’s own effects preset still applies.';

const percentText = (value: number) => `${String(Math.round(value))}%`;

/** The output level: the transport's master volume preference, not score data. */
export function MasterStrip() {
  const { playback, audio } = useAppServices();
  const volume = useStore(playback, (state) => state.settings.masterVolume);
  const gmTierBypass = useStore(playback, (state) => state.settings.gmTierBypass);
  const channelEffects = useStore(playback, (state) => state.settings.channelEffects);
  const percent = volume * 100;
  const channelId = useId();
  const channelNoteId = useId();
  const bypassId = useId();
  const noteId = useId();
  const menu = useStaticContextMenu({
    surface: 'mixer.master',
    target: { kind: 'mixerMaster' },
    label: 'Master',
  });

  return (
    <div {...menu} className="flex flex-col gap-1.5 border-t px-3 py-2">
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
      <div className="flex flex-col gap-0.5">
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
            No automatic effects on GM sounds
          </label>
        </div>
        <p id={noteId} className="text-muted-foreground text-xs">
          {BYPASS_NOTE}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Switch
            id={channelId}
            size="sm"
            checked={channelEffects}
            aria-describedby={channelNoteId}
            onCheckedChange={(on) => {
              audio.setChannelEffects(on);
            }}
          />
          <label htmlFor={channelId} className="text-xs">
            Reverb and chorus from the file
          </label>
        </div>
        <p id={channelNoteId} className="text-muted-foreground text-xs">
          {CHANNEL_NOTE}
        </p>
      </div>
    </div>
  );
}
