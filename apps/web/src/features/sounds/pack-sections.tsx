import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { curatedPack, updateAvailable } from './curated-packs';
import { FAMILY_LABELS, formatBytes, type InstalledPack, type PackManifest } from './manifest';
import type { DamagedPack, InstallJob, PackProblem } from './pack-store';

export const PHASE_LABELS = {
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

/**
 * The visible progress. It is not a live region: the screen announces the phases and the outcome
 * once each (a tick per file would make a screen reader read the whole block again and again).
 */
export function InstallProgress({ job, onCancel }: { job: InstallJob; onCancel: () => void }) {
  const known = job.total !== undefined && job.total > 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium">Installing {job.name}</span>
        <div
          role="progressbar"
          aria-label={`Installing ${job.name}`}
          aria-valuemin={0}
          {...(known && { 'aria-valuemax': job.total, 'aria-valuenow': job.done })}
          className="bg-muted h-2 w-full overflow-hidden rounded-full"
        >
          <div
            className={known ? 'bg-primary h-full' : 'bg-primary h-full w-full animate-pulse'}
            style={known ? { width: `${String((job.done / (job.total ?? 1)) * 100)}%` } : undefined}
          />
        </div>
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
                {problem.problems.slice(0, 8).map((line, index) => (
                  // The same report line can occur twice (two files, one cause).
                  <li key={`${String(index)}:${line}`}>{line}</li>
                ))}
                {problem.problems.length > 8 && <li>and {problem.problems.length - 8} more</li>}
              </ul>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Dismiss the problem with ${problem.name}`}
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

const hasFiles = (transfer: DataTransfer) => transfer.types.includes('Files');

/** A row that takes a zip dropped on it. The screen behind skips an event the row already handled. */
function DropRow({
  packId,
  onDropFiles,
  className,
  children,
}: {
  packId: string;
  onDropFiles?: (transfer: DataTransfer) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <li
      data-pack-id={packId}
      className={className}
      onDragOver={(event) => {
        if (onDropFiles && hasFiles(event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!onDropFiles || !hasFiles(event.dataTransfer)) return;
        // Not `stopPropagation`: the window's drop zone must still see the event to clear its
        // overlay. The screen's own handler skips a default-prevented event instead.
        event.preventDefault();
        onDropFiles(event.dataTransfer);
      }}
    >
      {children}
    </li>
  );
}

export interface InstalledRowProps {
  pack: InstalledPack;
  /** Tracks of the open song that use it; undefined when no song is open. */
  usedBy: number | undefined;
  busy: boolean;
  canDownload: boolean;
  onRemove: (pack: InstalledPack) => void;
  onRename: (pack: InstalledPack, name: string) => void;
  onUpdate: (pack: InstalledPack) => void;
  onChooseZip: (pack: InstalledPack) => void;
  onDropZip: (pack: InstalledPack, transfer: DataTransfer) => void;
}

export function InstalledRow(props: InstalledRowProps) {
  const { pack, usedBy, busy, canDownload } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(pack.name);
  const listed = pack.curated ? curatedPack(pack.id) : undefined;
  const outdated = pack.curated && updateAvailable(pack);
  const renameButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  // The form's buttons unmount when it closes: focus goes back to the Rename button.
  useEffect(() => {
    if (!renaming && restoreFocus.current) {
      restoreFocus.current = false;
      renameButton.current?.focus();
    }
  }, [renaming]);
  const closeRename = () => {
    restoreFocus.current = true;
    setRenaming(false);
  };
  const extra = [
    pack.curated ? `Version ${pack.version}` : 'Custom pack',
    usedBy !== undefined && usedBy > 0
      ? `Used by ${String(usedBy)} ${usedBy === 1 ? 'track' : 'tracks'} in this song`
      : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <DropRow
      packId={pack.id}
      {...(pack.curated && {
        onDropFiles: (transfer: DataTransfer) => {
          props.onDropZip(pack, transfer);
        },
      })}
      className="flex items-center gap-3 rounded-lg border p-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {renaming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim() === '') return;
              props.onRename(pack, draft);
              closeRename();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              // Cancels the rename only; the screen behind closes on a second Escape.
              event.stopPropagation();
              closeRename();
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
            <Button type="submit" size="sm" disabled={draft.trim() === ''}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={closeRename}>
              Cancel
            </Button>
          </form>
        ) : (
          <h4 className="truncate text-sm font-medium">{pack.name}</h4>
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
          (canDownload && listed?.directDownload === true ? (
            <Button
              size="sm"
              disabled={busy}
              aria-label={`Update ${pack.name}`}
              onClick={() => {
                props.onUpdate(pack);
              }}
            >
              Update
            </Button>
          ) : (
            <>
              {(listed?.sourceUrl ?? pack.sourceUrl) !== undefined && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={listed?.sourceUrl ?? pack.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open download page for ${pack.name}`}
                  >
                    Open download page
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`Choose zip to update ${pack.name}`}
                onClick={() => {
                  props.onChooseZip(pack);
                }}
              >
                Choose zip…
              </Button>
            </>
          ))}
        {!pack.curated && !renaming && (
          <Button
            variant="outline"
            size="sm"
            ref={renameButton}
            aria-label={`Rename ${pack.name}`}
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
          data-focus={`remove-${pack.id}`}
          aria-label={`Remove ${pack.name}`}
          onClick={() => {
            props.onRemove(pack);
          }}
        >
          Remove
        </Button>
      </div>
    </DropRow>
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
    <DropRow
      packId={pack.id}
      onDropFiles={(transfer) => {
        onDropZip(pack, transfer);
      }}
      className="flex items-center gap-3 rounded-lg border p-3"
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
                <a
                  href={pack.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open download page for ${pack.name}`}
                >
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
    </DropRow>
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
