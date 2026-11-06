import { PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useAppServices } from '@/app/services-context';
import { selectCanPlay, selectRunning } from '@/state/playback';

import { TransportButton } from './controls';

export function PlaybackButtons() {
  const { playback } = useAppServices();
  const { canPlay, running } = useStore(
    playback,
    useShallow((state) => ({ canPlay: selectCanPlay(state), running: selectRunning(state) })),
  );
  const label = running ? 'Pause' : 'Play';
  const Icon = running ? PauseIcon : PlayIcon;

  return (
    <div role="group" aria-label="Playback" className="flex items-center">
      <TransportButton command="transport.playPause" label={label} disabled={!canPlay}>
        <Icon />
      </TransportButton>
      <TransportButton command="transport.stop" label="Stop" disabled={!canPlay}>
        <SquareIcon />
      </TransportButton>
    </div>
  );
}
