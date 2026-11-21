import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useSetting } from '@/app/use-setting';
import { Button } from '@/components/ui/button';

import { curatedPack } from './curated-packs';
import { OFFERED_PACKS_SETTING } from './default-sounds';
import { FAMILY_LABELS, formatBytes, type PackFamily, type PackManifest } from './manifest';
import { PHASE_LABELS } from './pack-sections';

/** "guitar" for both guitar families, the family's own name otherwise. */
const nounOf = (family: PackFamily): string =>
  family.endsWith('guitar') ? 'guitar' : FAMILY_LABELS[family].toLowerCase();

/**
 * The one-time offer of a family default's pack (#346): shown when the open song has a track
 * whose default names a curated, directly downloadable pack that is not installed. It never blocks
 * playback (the track plays General MIDI meanwhile), takes no focus, and is shown once per pack id,
 * whatever the answer: the Sounds section of Settings stays as the way back.
 *
 * It sits over the bottom left of the score area (the frame's `scoreOverlay`), where it covers no
 * control. Its announcement is a polite live region of its own, mounted outside the score area
 * (a live region inside it would keep the hidden player reachable under a sheet) and empty until
 * the offer shows, because a region that appears already filled is often not read.
 */
export function DefaultSoundOffer() {
  const { settings, sounds, playback, platform, ui } = useAppServices();
  const offered = useSetting(OFFERED_PACKS_SETTING);
  const scanned = useStore(sounds.api, (state) => state.scanned);
  const job = useStore(sounds.api, (state) => state.job);
  const problems = useStore(sounds.api, (state) => state.problems);
  const installed = useStore(sounds.api, (state) => state.packs);
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
  // Installed, but the rebuild has not decoded it yet: nothing left to offer.
  const there = current !== undefined && installed.some((pack) => pack.id === current.id);
  const show =
    current !== undefined &&
    !dismissed &&
    !there &&
    (installing !== undefined || missing(current.id));

  const failure = current === undefined ? undefined : problems[current.id];
  const download = (pack: PackManifest) => {
    void sounds.installCurated(pack);
  };

  return (
    <>
      {createPortal(
        <div role="status" aria-live="polite" className="sr-only">
          {show ? `Sound pack offer: ${current.name}` : ''}
        </div>,
        document.body,
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)]">
        {show && (
          <div
            data-default-sound-offer
            className="bg-popover text-popover-foreground pointer-events-auto w-96 max-w-full rounded-lg border p-3 text-sm shadow-lg"
          >
            <OfferBody
              pack={current}
              installingPhase={installing ? PHASE_LABELS[installing.phase] : undefined}
              failure={failure?.message}
              canDownload={platform.download !== undefined}
              onDownload={() => {
                download(current);
              }}
              onOpenSounds={() => {
                ui.getState().showSheet('sounds');
                setDismissed(true);
              }}
              onCancel={() => {
                sounds.cancel();
              }}
              onDismiss={() => {
                setDismissed(true);
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

function OfferBody({
  pack,
  installingPhase,
  failure,
  canDownload,
  onDownload,
  onOpenSounds,
  onCancel,
  onDismiss,
}: {
  pack: PackManifest;
  installingPhase: string | undefined;
  failure: string | undefined;
  canDownload: boolean;
  onDownload: () => void;
  onOpenSounds: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const size = pack.download?.sizeBytes ?? pack.sizeBytes;
  const noun = nounOf(pack.family);
  return (
    <>
      <p className="font-medium">Better {noun} sounds</p>
      <p className="text-muted-foreground mt-1">
        {noun.charAt(0).toUpperCase() + noun.slice(1)} tracks can play {pack.name}
        {size === undefined ? '' : `, a free ${formatBytes(size)} download`}.
      </p>
      {installingPhase !== undefined && (
        <p className="text-muted-foreground mt-1 text-xs">Installing: {installingPhase}</p>
      )}
      {failure !== undefined && installingPhase === undefined && (
        <p className="mt-1 text-xs">The download failed: {failure}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        {installingPhase !== undefined ? (
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <>
            {canDownload ? (
              <Button size="xs" onClick={onDownload}>
                {failure === undefined ? 'Download' : 'Retry'}
              </Button>
            ) : (
              <Button size="xs" onClick={onOpenSounds}>
                Open Sounds
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={onDismiss}>
              Not now
            </Button>
          </>
        )}
      </div>
    </>
  );
}
