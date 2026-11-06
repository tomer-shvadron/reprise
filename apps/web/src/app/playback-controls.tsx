import { PauseIcon, PlayIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { selectCanPlay, selectRunning, type PlaybackStoreState } from '@/state/playback';

import { useAppServices } from './services-context';

const MB = 1024 * 1024;

/** What the sound status line says, and whether it offers Retry. */
export function soundStatus(
  state: PlaybackStoreState,
): { text: string; retry: boolean } | undefined {
  if (state.output.status === 'error') return { text: 'Audio output unavailable', retry: true };
  if (state.sounds.status === 'error') return { text: 'Sounds unavailable', retry: true };
  if (state.sounds.status === 'loading') {
    const { loaded, total } = state.sounds;
    return {
      text: total
        ? `Loading sounds… ${String(Math.floor((loaded / total) * 100))}%`
        : 'Loading sounds…',
      retry: false,
    };
  }
  if (state.song.status === 'error') return { text: 'Sounds unavailable', retry: true };
  if (state.song.status === 'loading') return { text: 'Preparing instruments…', retry: false };
  return undefined;
}

export function PlaybackControls() {
  const { playback, audio } = useAppServices();
  const { canPlay, running, text, retry, memory } = useStore(
    playback,
    useShallow((state) => {
      const status = soundStatus(state);
      return {
        canPlay: selectCanPlay(state),
        running: selectRunning(state),
        text: status?.text,
        retry: status?.retry ?? false,
        memory: state.memory,
      };
    }),
  );
  const label = running ? 'Pause' : 'Play';
  const Icon = running ? PauseIcon : PlayIcon;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={!canPlay}
        onClick={() => {
          audio.togglePlay();
        }}
      >
        <Icon />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="status" className="text-muted-foreground min-w-0 truncate text-xs">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {(memory.decodedBytes / MB).toFixed(1)} of {(memory.budgetBytes / MB).toFixed(0)} MB
          decoded · {memory.residents.length} instruments
        </TooltipContent>
      </Tooltip>
      {retry && (
        <Button
          variant="link"
          size="xs"
          onClick={() => {
            audio.retry();
          }}
        >
          Retry
        </Button>
      )}
    </>
  );
}
