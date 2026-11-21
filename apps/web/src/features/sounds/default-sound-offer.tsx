import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useSetting } from '@/app/use-setting';
import { Button } from '@/components/ui/button';

import { curatedPack } from './curated-packs';
import { OFFERED_PACKS_SETTING } from './default-sounds';
import { formatBytes, type PackManifest } from './manifest';
import { PHASE_LABELS } from './pack-sections';

/**
 * The one-time offer of a family default's pack (#346): shown when the open song has a track
 * whose default names a curated, directly downloadable pack that is not installed. It never blocks
 * playback (the track plays General MIDI meanwhile), and it is shown once per pack id, whatever the
 * answer: the Sounds section of Settings stays as the way back.
 */
export function DefaultSoundOffer() {
  const { settings, sounds, playback, platform, ui } = useAppServices();
  const offered = useSetting(OFFERED_PACKS_SETTING);
  const scanned = useStore(sounds.api, (state) => state.scanned);
  const job = useStore(sounds.api, (state) => state.job);
  const trackSounds = useStore(playback, (state) => state.trackSounds);
  const [hydrated, setHydrated] = useState(false);
  const [current, setCurrent] = useState<PackManifest | undefined>();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    void settings.whenHydrated().then(() => {
      if (live) setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, [settings]);

  const missing = (id: string) =>
    Object.values(trackSounds).some(
      (entry) => entry.source === 'default' && entry.problem === 'missing' && entry.packId === id,
    );

  // Before hydration the list of offered packs reads empty, and before the scan every pack reads
  // as not installed: either would offer a pack again, or one that is there.
  const candidate =
    hydrated && scanned && current === undefined
      ? Object.values(trackSounds)
          .map((entry) => (entry.source === 'default' ? entry.packId : undefined))
          .map((id) => (id === undefined ? undefined : curatedPack(id)))
          .find(
            (pack) =>
              pack?.directDownload === true && missing(pack.id) && !offered.includes(pack.id),
          )
      : undefined;

  // Remembered at render so the offer outlives the "not offered yet" test that raised it.
  if (candidate) setCurrent(candidate);
  useEffect(() => {
    if (current && !offered.includes(current.id)) {
      settings.set(OFFERED_PACKS_SETTING, [...offered, current.id]);
    }
  }, [current, offered, settings]);

  const installing = current !== undefined && job?.packId === current.id ? job : undefined;
  if (!current || dismissed || (!installing && !missing(current.id))) return null;

  const size = current.download?.sizeBytes ?? current.sizeBytes;
  const kind = current.family.endsWith('guitar') ? 'Guitar tracks' : 'Some tracks';
  return (
    <div
      role="status"
      className="bg-popover text-popover-foreground pointer-events-auto w-96 max-w-full rounded-lg border p-3 text-sm shadow-lg"
    >
      <p className="font-medium">Better guitar sounds</p>
      <p className="text-muted-foreground mt-1">
        {kind} can play {current.name}
        {size === undefined ? '' : `, a free ${formatBytes(size)} download`}.
      </p>
      {installing && (
        <p className="text-muted-foreground mt-1 text-xs">
          Installing: {PHASE_LABELS[installing.phase]}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        {installing ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              sounds.cancel();
            }}
          >
            Cancel
          </Button>
        ) : (
          <>
            {platform.download !== undefined ? (
              <Button
                size="xs"
                onClick={() => {
                  void sounds.installCurated(current);
                }}
              >
                Download
              </Button>
            ) : (
              <Button
                size="xs"
                onClick={() => {
                  ui.getState().showSheet('sounds');
                  setDismissed(true);
                }}
              >
                Open Sounds
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setDismissed(true);
              }}
            >
              Not now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
