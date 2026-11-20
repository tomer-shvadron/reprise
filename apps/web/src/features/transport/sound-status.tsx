import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { keepFocus } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { StatusSegment } from '@/app/status-bar/segment';
import { Button } from '@/components/ui/button';
import type { PlaybackStoreState } from '@/state/playback';

import { soundTierLabel } from './sound-tier';

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

/** A pack install in flight, which goes on while the Sounds sheet is closed. */
export interface InstallProgress {
  name: string;
  phase: string;
  done: number;
  total: number | undefined;
}

/** What the sound status line says, and whether it offers Retry. */
export function soundStatus(
  state: PlaybackStoreState,
  install?: InstallProgress,
): SoundStatusLine | undefined {
  if (state.output.status === 'error') return line('Audio output unavailable', true);
  if (install) {
    // `done` and `total` count the current phase, so the phase is named: a second climb from 0%
    // under the same name would read as a restart.
    const stage = `Installing ${install.name}`;
    const phase = `${stage} · ${install.phase}`;
    return install.total
      ? {
          text: `${phase} ${String(Math.floor((Math.min(install.done, install.total) / install.total) * 100))}%`,
          stage,
          retry: false,
        }
      : { text: `${phase}…`, stage, retry: false };
  }
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

/**
 * The sound bank's and the song's load state, then the sound tier and the decoded memory, and
 * Retry after an error. A segment of the status bar: a click opens the Sounds sheet.
 */
export function SoundStatus() {
  const { playback, audio, document, sounds } = useAppServices();
  const job = useStore(sounds.api, (state) => state.job);
  const { text, retry, memory, trackSounds } = useStore(
    playback,
    useShallow((state) => {
      const status = soundStatus(state, job);
      return {
        text: status?.text,
        retry: status?.retry ?? false,
        memory: state.memory,
        trackSounds: state.trackSounds,
      };
    }),
  );
  const trackIds = useStore(
    document,
    useShallow((state) => state.score?.tracks.map((track) => track.id) ?? []),
  );
  const tier = soundTierLabel(trackIds, trackSounds);
  // Nothing to say before the first sound loads, and an empty button would have no name.
  const hidden = text === undefined && memory.decodedBytes === 0;

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {!hidden && (
        // Not a live region: progress would be read out at every percent; the announcer in the
        // transport speaks each stage once. The `data-sound-status` text ends in `N MB`, which the
        // desktop smoke test waits on.
        <StatusSegment
          command="sounds.show"
          label={`Sounds: ${megabytes(memory.decodedBytes)} of ${megabytes(memory.budgetBytes)} MB decoded · ${String(memory.residents.length)} ${memory.residents.length === 1 ? 'instrument' : 'instruments'} loaded (${String(memory.unused.length)} unused)`}
          aria-live="off"
          data-sound-status
          className="min-w-0 shrink"
        >
          {/* The button cannot shrink its own text; this span does, with an ellipsis. */}
          <span className="min-w-0 truncate">
            {text ?? (
              <>
                <span className="@max-[50rem]:hidden">{tier} · </span>
                {megabytes(memory.decodedBytes)} MB
              </>
            )}
          </span>
        </StatusSegment>
      )}
      {retry && (
        <Button
          variant="link"
          size="xs"
          className="text-2xs! h-5 px-1"
          onMouseDown={keepFocus}
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
