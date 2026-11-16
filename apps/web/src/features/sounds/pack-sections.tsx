import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { updateAvailable } from './curated-packs';
import { FAMILY_LABELS, formatBytes, type InstalledPack, type PackManifest } from './manifest';
import type { DamagedPack, InstallJob, PackProblem } from './pack-store';

const PHASE_LABELS = {
  downloading: 'Downloading',
  extracting: 'Copying files',
  checking: 'Checking the pack',
  committing: 'Finishing',
} as const;

function progressText(job: InstallJob): string {
  const label = PHASE_LABELS[job.phase];
  if (job.total === undefined || job.total === 0) {
    return job.done > 0 && job.phase === 'downloading'
      ? `${label} ${formatBytes(job.done)}`
      : `${label}...`;
  }
  return `${label}: ${formatBytes(job.done)} of ${formatBytes(job.total)}`;
}

export function InstallProgress({ job, onCancel }: { job: InstallJob; onCancel: () => void }) {
  const known = job.total !== undefined && job.total > 0;
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border p-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">Installing {job.name}</span>
        <progress
          aria-label={`Installing ${job.name}`}
          className="h-1.5 w-full"
          max={known ? (job.total ?? 1) : undefined}
          value={known ? job.done : undefined}
        />
        <span className="text-muted-foreground text-xs">{progressText(job)}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function ProblemList({
  problems,
  onDismiss,
}: {
  problems: Readonly<Record<string, PackProblem>>;
  onDismiss: (id: string) => void;
}) {
  const entries = Object.entries(problems);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Problems">
      {entries.map(([id, problem]) => (
        <li
          key={id}
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border p-3 text-sm"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-medium">{problem.name}</span>
            <span>{problem.message}</span>
            {problem.problems.length > 0 && (
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {problem.problems.slice(0, 8).map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {problem.problems.length > 8 && <li>and {problem.problems.length - 8} more</li>}
              </ul>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onDismiss(id);
            }}
          >
            Dismiss
          </Button>
        </li>
      ))}
    </ul>
  );
}

function LicenceLink({ pack }: { pack: Pick<PackManifest, 'licenseName' | 'licenseUrl'> }) {
  if (pack.licenseName === undefined) return <span>Licence not recorded</span>;
  if (pack.licenseUrl === undefined) return <span>{pack.licenseName}</span>;
  return (
    <a
      href={pack.licenseUrl}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {pack.licenseName}
    </a>
  );
}

function Details({ pack, extra }: { pack: PackManifest; extra?: string }) {
  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
      <span>{FAMILY_LABELS[pack.family]}</span>
      {pack.sizeBytes !== undefined && <span>{formatBytes(pack.sizeBytes)}</span>}
      <LicenceLink pack={pack} />
      {extra && <span>{extra}</span>}
    </p>
  );
}

export interface InstalledRowProps {
  pack: InstalledPack;
  /** Tracks of the open song that use it. */
  usedBy: number;
  busy: boolean;
  canDownload: boolean;
  onRemove: (pack: InstalledPack) => void;
  onRename: (pack: InstalledPack, name: string) => void;
  onUpdate: (pack: InstalledPack) => void;
  onChooseZip: (manifest: PackManifest) => void;
}

export function InstalledRow(props: InstalledRowProps) {
  const { pack, usedBy, busy, canDownload } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(pack.name);
  const outdated = pack.curated && updateAvailable(pack);
  const extra = [
    pack.curated ? `Version ${pack.version}` : 'Custom pack',
    usedBy > 0 ? `Used by ${String(usedBy)} ${usedBy === 1 ? 'track' : 'tracks'}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li data-pack-id={pack.id} className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {renaming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              props.onRename(pack, draft);
              setRenaming(false);
            }}
          >
            <Input
              aria-label={`Name of ${pack.name}`}
              value={draft}
              maxLength={120}
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <h3 className="truncate text-sm font-medium">{pack.name}</h3>
        )}
        <Details pack={pack} extra={extra} />
        <p className="text-xs">
          {outdated ? (
            <span className="text-primary">Update available</span>
          ) : (
            <span className="text-muted-foreground">Installed</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {outdated &&
          (canDownload && pack.directDownload ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                props.onUpdate(pack);
              }}
            >
              Update
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                props.onChooseZip(pack);
              }}
            >
              Choose zip…
            </Button>
          ))}
        {!pack.curated && !renaming && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(pack.name);
              setRenaming(true);
            }}
          >
            Rename
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          aria-label={`Remove ${pack.name}`}
          onClick={() => {
            props.onRemove(pack);
          }}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

export interface AvailableRowProps {
  pack: PackManifest;
  busy: boolean;
  canDownload: boolean;
  onDownload: (pack: PackManifest) => void;
  onChooseZip: (pack: PackManifest) => void;
  onDropZip: (pack: PackManifest, transfer: DataTransfer) => void;
}

export function AvailableRow({
  pack,
  busy,
  canDownload,
  onDownload,
  onChooseZip,
  onDropZip,
}: AvailableRowProps) {
  const direct = pack.directDownload && canDownload;
  return (
    <li
      data-pack-id={pack.id}
      className="flex items-center gap-3 rounded-lg border p-3"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        // The screen behind would install it as a custom pack too.
        event.stopPropagation();
        onDropZip(pack, event.dataTransfer);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-sm font-medium">{pack.name}</h3>
        <Details pack={pack} />
        <p className="text-muted-foreground text-xs">
          {direct
            ? 'Not installed'
            : 'Not installed. Download it from the pack’s page, then choose or drop the zip here.'}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {direct ? (
          <Button
            size="sm"
            disabled={busy}
            aria-label={`Download ${pack.name}`}
            onClick={() => {
              onDownload(pack);
            }}
          >
            Download
          </Button>
        ) : (
          <>
            {pack.sourceUrl !== undefined && (
              <Button asChild variant="outline" size="sm">
                <a href={pack.sourceUrl} target="_blank" rel="noreferrer">
                  Open download page
                </a>
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy}
              aria-label={`Choose zip for ${pack.name}`}
              onClick={() => {
                onChooseZip(pack);
              }}
            >
              Choose zip…
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function DamagedRow({
  damaged,
  onRemove,
}: {
  damaged: DamagedPack;
  onRemove: (folder: string) => void;
}) {
  return (
    <li className="border-destructive/40 flex items-center gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-sm font-medium">{damaged.folder}</h3>
        <p className="text-muted-foreground text-xs">Damaged: {damaged.reason}</p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        aria-label={`Remove damaged folder ${damaged.folder}`}
        onClick={() => {
          onRemove(damaged.folder);
        }}
      >
        Remove
      </Button>
    </li>
  );
}
