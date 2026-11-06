import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlaybackStoreState } from '@/state/playback';

const MB = 1024 * 1024;

/** Megabytes with one decimal below 10, so 0.63 MB does not read as 1 MB. */
export function megabytes(bytes: number): string {
  const mb = bytes / MB;
  return mb < 10 ? mb.toFixed(1) : mb.toFixed(0);
}

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

/** The sound bank's and the song's load state, the decoded memory, and Retry after an error. */
export function SoundStatus() {
  const { playback, audio } = useAppServices();
  const { text, retry, memory, instruments } = useStore(
    playback,
    useShallow((state) => {
      const status = soundStatus(state);
      return {
        text: status?.text,
        retry: status?.retry ?? false,
        memory: state.memory,
        instruments: state.instruments,
      };
    }),
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="status" className="text-muted-foreground min-w-0 truncate text-xs">
            {text ?? (memory.decodedBytes > 0 && `${megabytes(memory.decodedBytes)} MB`)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {megabytes(memory.decodedBytes)} of {megabytes(memory.budgetBytes)} MB decoded ·{' '}
          {instruments} {instruments === 1 ? 'instrument' : 'instruments'}
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
    </div>
  );
}
