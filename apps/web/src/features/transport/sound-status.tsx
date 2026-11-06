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

export interface SoundStatusLine {
  text: string;
  /** The text without its progress, which the announcer speaks once per stage. */
  stage: string;
  retry: boolean;
}

const line = (text: string, retry: boolean): SoundStatusLine => ({ text, stage: text, retry });

/** What the sound status line says, and whether it offers Retry. */
export function soundStatus(state: PlaybackStoreState): SoundStatusLine | undefined {
  if (state.output.status === 'error') return line('Audio output unavailable', true);
  if (state.sounds.status === 'error') return line('Sounds unavailable', true);
  if (state.sounds.status === 'loading') {
    const { loaded, total } = state.sounds;
    const stage = 'Loading sounds…';
    return total
      ? { text: `${stage} ${String(Math.floor((loaded / total) * 100))}%`, stage, retry: false }
      : line(stage, false);
  }
  if (state.song.status === 'error') return line('Sounds unavailable', true);
  if (state.song.status === 'loading') return line('Preparing instruments…', false);
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
          {/* Not a live region: progress would be read out at every percent; the announcer
              speaks each stage once. */}
          <span
            aria-live="off"
            data-sound-status
            className="text-muted-foreground min-w-0 truncate text-xs"
          >
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
