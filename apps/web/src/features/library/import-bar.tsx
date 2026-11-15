import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';

import type { ImportProgress } from './import/importer';
import type { Library } from './library';

const count = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

/** "Imported 48 · 1 already in library · 1 failed", for a finished batch. */
export function summaryOf(progress: ImportProgress): string {
  const parts = [`Imported ${String(progress.imported)}`];
  if (progress.duplicates > 0) parts.push(`${String(progress.duplicates)} already in library`);
  if (progress.failed.length > 0) parts.push(`${String(progress.failed.length)} failed`);
  if (progress.skipped > 0) parts.push(`${count(progress.skipped, 'file')} skipped`);
  if (progress.cancelled) parts.push('cancelled');
  return parts.join(' · ');
}

/** The import buttons, the progress of a running batch and the summary of the last one. */
export function ImportBar({ library }: { library: Library }) {
  const progress = useStore(library.importer.store);
  const running = progress.phase === 'running';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void library.importFiles();
          }}
        >
          Import files…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void library.importFolder();
          }}
        >
          Import folder…
        </Button>
        {running && (
          <>
            <div
              role="progressbar"
              aria-label="Import progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="bg-muted h-2 w-48 overflow-hidden rounded-full"
            >
              <div
                className="bg-primary h-full"
                style={{ width: `${String((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
              />
            </div>
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {progress.done}/{progress.total}
              {progress.current && <span className="ml-2 truncate">{progress.current}</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                library.importer.cancel();
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
      {progress.phase === 'done' && (
        <div role="status" className="text-sm">
          <div className="flex items-center gap-2">
            <span>{summaryOf(progress)}</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                library.importer.dismiss();
              }}
            >
              Dismiss
            </Button>
          </div>
          {(progress.truncated || progress.unreadableFolders > 0) && (
            <p className="text-muted-foreground">
              {progress.truncated && 'The folder holds more files than one import takes. '}
              {progress.unreadableFolders > 0 &&
                `${count(progress.unreadableFolders, 'folder')} could not be read.`}
            </p>
          )}
          {progress.failed.length > 0 && (
            <ul
              aria-label="Import failures"
              className="text-destructive mt-1 max-h-32 overflow-y-auto"
            >
              {progress.failed.map((failure, index) => (
                <li key={`${failure.name}-${String(index)}`}>
                  {failure.name}: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
