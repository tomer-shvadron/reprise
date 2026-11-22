import type { MenuChecks } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';
import { isFixed } from '@/features/transport/tempo';
import type { PlaybackStore, TransportSettings } from '@/state/playback';

/** The checkbox items of the native Playback menu, from the playback settings. */
export function menuChecksOf(settings: TransportSettings): MenuChecks {
  return {
    'transport.toggleLoop': settings.loop !== undefined,
    'transport.toggleCountIn': settings.countIn,
    'transport.toggleMetronome': settings.metronome.on,
    'transport.toggleFixedTempo': isFixed(settings.tempo),
  };
}

/**
 * Gives the native Playback menu the state of its checkbox items (and, through Fixed Tempo, the
 * unit of Slow Down and Speed Up). Pushes at once and on every change. A map is not sent again
 * while it is in flight or once applied, and one that failed waits for a different map rather
 * than retrying on every position tick. Does nothing on a platform without a menu. Returns the
 * undo.
 */
export function installMenuChecks(deps: {
  playback: PlaybackStore;
  platform: Pick<Platform, 'setMenuChecks'>;
}): () => void {
  const { playback, platform } = deps;
  const { setMenuChecks } = platform;
  if (!setMenuChecks) return () => undefined;
  // What main has, what is on its way, and the map that was refused.
  let applied = '';
  let pending = '';
  let failed = '';
  let active = true;
  const push = () => {
    if (!active) return;
    const checks = menuChecksOf(playback.getState().settings);
    const text = JSON.stringify(checks);
    if (text === applied || text === pending || text === failed) return;
    pending = text;
    void setMenuChecks.call(platform, checks).then((ok) => {
      if (pending === text) pending = '';
      if (ok) {
        applied = text;
        failed = '';
      } else failed = text;
    });
  };
  push();
  const stop = playback.subscribe(push);
  return () => {
    active = false;
    stop();
  };
}
