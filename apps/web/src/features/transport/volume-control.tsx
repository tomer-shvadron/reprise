import { Volume1Icon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { LevelPopover } from './level-popover';

export function MasterVolume() {
  const { playback, audio } = useAppServices();
  const volume = useStore(playback, (state) => state.settings.masterVolume);
  const Icon = volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon;

  return (
    <div role="group" aria-label="Output" className="flex items-center">
      <LevelPopover
        popover="master"
        command="transport.masterVolume"
        label="Master volume"
        value={volume}
        onChange={(next) => {
          audio.setMasterVolume(next);
        }}
      >
        <Icon />
      </LevelPopover>
    </div>
  );
}
