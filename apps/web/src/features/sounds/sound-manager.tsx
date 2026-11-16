import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';

import { CURATED_PACKS, curatedPack } from './curated-packs';
import {
  PACK_EXTENSIONS,
  snapshotPackDrop,
  walkDroppedFolder,
  zipFileOf,
  type PackDrop,
} from './drop';
import { EffectsDemo } from './effects-demo';
import { FAMILY_LABELS, PACK_FAMILIES, type InstalledPack, type PackManifest } from './manifest';
import { MemoryPanel } from './memory-panel';
import type { ZipFile } from './pack-store';
import {
  AvailableRow,
  DamagedRow,
  InstallProgress,
  InstalledRow,
  PHASE_LABELS,
  ProblemList,
} from './pack-sections';
import { RemovePackDialog } from './remove-pack-dialog';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The Sounds screen: installed packs, the curated list (download or choose a zip), a custom
 * install from a folder or zip, remove, and what went wrong. A zip or folder dropped anywhere
 * on it installs as a custom pack; one dropped on a curated row (installed or not) installs that
 * pack. The memory panel is at the top and the effects demo stays below.
 */
export function SoundManager() {
  const { sounds, platform, document } = useAppServices();
  const packs = useStore(sounds.api, (state) => state.packs);
  const damaged = useStore(sounds.api, (state) => state.damaged);
  const job = useStore(sounds.api, (state) => state.job);
  const problems = useStore(sounds.api, (state) => state.problems);
  const tracks = useStore(document, (state) => state.score?.tracks);
  const [removing, setRemoving] = useState<InstalledPack | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const canDownload = platform.download !== undefined;
  const busy = job !== undefined;

  // Focus: what a click removed (a row, the progress block, a problem) leaves focus on <body>,
  // where Escape no longer reaches the screen. Each action names the element that gets it next.
  const focusTarget = useRef<string | undefined>(undefined);
  const applyFocus = () => {
    const key = focusTarget.current;
    if (key === undefined) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-focus="${key}"]`);
    if (!element || (element instanceof HTMLButtonElement && element.disabled)) return;
    focusTarget.current = undefined;
    element.focus();
  };
  const focusNext = (key: string) => {
    focusTarget.current = key;
  };
  useEffect(() => {
    if (removing === undefined) applyFocus();
  });

  // Announcements: the phase and every quarter of it, the outcome, and nothing per tick.
  const announced = useRef<{ job: string; phase: string; quarter: number } | undefined>(undefined);
  useEffect(() => {
    if (!job) {
      const last = announced.current;
      if (!last) return;
      announced.current = undefined;
      const state = sounds.getState();
      const problem = state.problems[last.job];
      if (problem) setAnnouncement(`${problem.name}: ${problem.message}`);
      else {
        const pack = state.packs.find((candidate) => candidate.id === last.job);
        setAnnouncement(pack ? `${pack.name} installed` : 'The install was cancelled');
      }
      return;
    }
    const last = announced.current;
    const quarter =
      job.total !== undefined && job.total > 0 ? Math.floor((job.done / job.total) * 4) : 0;
    if (last?.job !== job.packId || last.phase !== job.phase) {
      setAnnouncement(
        last?.job === job.packId
          ? PHASE_LABELS[job.phase]
          : `Installing ${job.name}: ${PHASE_LABELS[job.phase]}`,
      );
      announced.current = { job: job.packId, phase: job.phase, quarter: Math.min(quarter, 3) };
    } else if (quarter > last.quarter && quarter < 4) {
      setAnnouncement(`${PHASE_LABELS[job.phase]}, ${String(quarter * 25)}%`);
      announced.current = { ...last, quarter };
    }
  }, [job, sounds]);

  const usedBy = (id: string): number | undefined =>
    tracks?.filter((track) => track.sound?.packId === id).length;

  const available = useMemo(
    () => CURATED_PACKS.filter((pack) => !packs.some((installed) => installed.id === pack.id)),
    [packs],
  );
  const groups = useMemo(
    () =>
      PACK_FAMILIES.map((family) => ({
        family,
        packs: packs.filter((pack) => pack.family === family),
      })).filter((group) => group.packs.length > 0),
    [packs],
  );

  const guarded = async (action: () => Promise<void>) => {
    setNotice(undefined);
    try {
      await action();
    } catch (error) {
      setNotice(`That did not work: ${messageOf(error)}`);
    }
  };

  const chooseZip = (manifest?: PackManifest) =>
    guarded(async () => {
      const [file] = await platform.openFiles([{ name: 'Sound pack (zip)', extensions: ['zip'] }]);
      if (!file) return;
      const zip: ZipFile = { name: file.name, size: file.size, read: (range) => file.read(range) };
      await sounds.installZip(zip, manifest);
    });

  const chooseFolder = () =>
    guarded(async () => {
      const folder = await platform.openFolder([
        { name: 'Sound pack files', extensions: PACK_EXTENSIONS },
      ]);
      if (folder) await sounds.installFolder(folder);
    });

  const install = (drop: PackDrop, manifest?: PackManifest) =>
    guarded(async () => {
      const [file] = drop.files;
      const [directory] = drop.directories;
      if (drop.files.length + drop.directories.length !== 1) {
        setNotice('Drop one pack at a time: a zip, or a folder.');
      } else if (directory) {
        await sounds.installFolder(await walkDroppedFolder(directory), manifest);
      } else if (file && /\.zip$/i.test(file.name)) {
        await sounds.installZip(zipFileOf(file), manifest);
      } else {
        setNotice('Drop a zip or a folder of SFZ files.');
      }
    });

  const onDrop = (transfer: DataTransfer, manifest?: PackManifest) => {
    setNotice(undefined);
    // Taken before the first await: a DataTransfer is emptied once the handler returns.
    const drop = snapshotPackDrop(transfer);
    if (busy) {
      setNotice('Wait for the install that is running, or cancel it.');
      return;
    }
    void install(drop, manifest);
  };

  const curatedOf = (pack: PackManifest) => curatedPack(pack.id) ?? pack;

  return (
    <div
      ref={root}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        // A row that took the drop has prevented the default already; read that before this
        // handler prevents it too. Not `stopPropagation` on the row: the window's drop zone has
        // to see the event to clear its overlay.
        if (event.defaultPrevented) return;
        event.preventDefault();
        // The Remove confirm is a child in the React tree, so a file dropped on its overlay
        // arrives here too.
        if (removing) return;
        onDrop(event.dataTransfer);
      }}
    >
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold" tabIndex={-1} data-focus="screen-heading">
          Sounds
        </h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            data-focus="zip-button"
            onClick={() => {
              void chooseZip();
            }}
          >
            Install from zip…
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void chooseFolder();
            }}
          >
            Install from folder…
          </Button>
        </div>
      </div>
      <MemoryPanel onAnnounce={setAnnouncement} />
      {/* Mounted empty and filled later: a live region that appears filled is often not read. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <p className="text-muted-foreground text-sm">
        Sound packs replace General MIDI on a track. Drop a pack&rsquo;s zip or folder anywhere on
        this screen, or drop a zip on a pack below.
      </p>
      {job && (
        <InstallProgress
          job={job}
          onCancel={() => {
            focusNext('zip-button');
            sounds.cancel();
          }}
        />
      )}
      {notice && (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      )}
      <ProblemList
        problems={problems}
        onDismiss={(id) => {
          focusNext('screen-heading');
          sounds.dismissProblem(id);
        }}
      />

      <section aria-label="Installed packs" className="flex flex-col gap-3">
        <h2
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          tabIndex={-1}
          data-focus="installed-heading"
        >
          Installed
        </h2>
        {groups.length === 0 && damaged.length === 0 && (
          <p className="text-muted-foreground text-sm">No sound packs are installed.</p>
        )}
        {groups.map((group) => (
          <div key={group.family} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{FAMILY_LABELS[group.family]}</h3>
            <ul className="flex flex-col gap-2">
              {group.packs.map((pack) => (
                <InstalledRow
                  key={pack.id}
                  pack={pack}
                  usedBy={usedBy(pack.id)}
                  busy={busy}
                  canDownload={canDownload}
                  onRemove={setRemoving}
                  onRename={(target, name) => {
                    void sounds.rename(target.id, name);
                  }}
                  onUpdate={(target) => {
                    const listed = curatedPack(target.id);
                    if (listed) void sounds.installCurated(listed);
                  }}
                  onChooseZip={(target) => {
                    void chooseZip(curatedOf(target));
                  }}
                  onDropZip={(target, transfer) => {
                    onDrop(transfer, curatedOf(target));
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
        {damaged.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Damaged packs">
            {damaged.map((entry) => (
              <DamagedRow
                key={entry.folder}
                damaged={entry}
                onRemove={(folder) => {
                  focusNext('installed-heading');
                  void sounds.removeDamaged(folder);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {available.length > 0 && (
        <section aria-label="Available packs" className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Available
          </h2>
          <ul className="flex flex-col gap-2">
            {available.map((pack) => (
              <AvailableRow
                key={pack.id}
                pack={pack}
                busy={busy}
                canDownload={canDownload}
                onDownload={(target) => {
                  void sounds.installCurated(target);
                }}
                onChooseZip={(target) => {
                  void chooseZip(target);
                }}
                onDropZip={(target, transfer) => {
                  onDrop(transfer, target);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <RemovePackDialog
        pack={removing}
        usedBy={removing ? usedBy(removing.id) : undefined}
        onCancel={() => {
          if (removing) focusNext(`remove-${removing.id}`);
          setRemoving(undefined);
        }}
        onConfirm={(pack) => {
          focusNext('installed-heading');
          setRemoving(undefined);
          void sounds.remove(pack.id);
        }}
        onClosed={applyFocus}
      />

      <section aria-label="Effects" className="max-w-lg">
        <EffectsDemo />
      </section>
    </div>
  );
}
