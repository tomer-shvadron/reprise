import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';

import { CURATED_PACKS, curatedPack } from './curated-packs';
import { snapshotPackDrop, walkDroppedFolder, zipFileOf, type PackDrop } from './drop';
import { EffectsDemo } from './effects-demo';
import { FAMILY_LABELS, PACK_FAMILIES, type InstalledPack, type PackManifest } from './manifest';
import type { ZipFile } from './pack-store';
import {
  AvailableRow,
  DamagedRow,
  InstallProgress,
  InstalledRow,
  ProblemList,
} from './pack-sections';
import { RemovePackDialog } from './remove-pack-dialog';

const PACK_EXTENSIONS = ['sfz', 'sfzh', 'inc', 'wav', 'flac', 'ogg', 'oga', 'opus', 'txt', 'md'];

/**
 * The Sounds screen: installed packs, the curated list (download or choose a zip), a custom
 * install from a folder or zip, remove, and what went wrong. A zip or folder dropped anywhere
 * on it installs as a custom pack; one dropped on a curated row installs that pack. WP-094 fills
 * the slot at the top with the memory readout; the effects demo stays below until it is retired.
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
  const canDownload = platform.download !== undefined;
  const busy = job !== undefined;

  const usedBy = (id: string) => tracks?.filter((track) => track.sound?.packId === id).length ?? 0;

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

  const chooseZip = async (manifest?: PackManifest) => {
    setNotice(undefined);
    const [file] = await platform.openFiles([{ name: 'Sound pack (zip)', extensions: ['zip'] }]);
    if (!file) return;
    const zip: ZipFile = {
      name: file.name,
      size: file.size,
      read: (range) => file.read(range),
    };
    await sounds.installZip(zip, manifest);
  };

  const chooseFolder = async () => {
    setNotice(undefined);
    const folder = await platform.openFolder([
      { name: 'Sound pack files', extensions: PACK_EXTENSIONS },
    ]);
    if (folder) await sounds.installFolder(folder);
  };

  const install = async (drop: PackDrop, manifest?: PackManifest) => {
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
  };

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
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        onDrop(event.dataTransfer);
      }}
    >
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Sounds</h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
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
      {/* WP-094: the memory readout (resident and budget bytes) goes here. */}
      <div data-slot="memory-readout" />
      <p className="text-muted-foreground text-sm">
        Sound packs replace General MIDI on a track. Drop a pack&rsquo;s zip or folder anywhere on
        this screen, or drop a zip on a pack below.
      </p>
      {job && <InstallProgress job={job} onCancel={sounds.cancel} />}
      {notice && (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      )}
      <ProblemList problems={problems} onDismiss={sounds.dismissProblem} />

      <section aria-label="Installed packs" className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
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
        usedBy={removing ? usedBy(removing.id) : 0}
        onCancel={() => {
          setRemoving(undefined);
        }}
        onConfirm={(pack) => {
          setRemoving(undefined);
          void sounds.remove(pack.id);
        }}
      />

      <section aria-label="Effects" className="max-w-lg">
        <EffectsDemo />
      </section>
    </div>
  );
}
