import { MAX_FILE_BYTES } from '@reprise/formats';
import { useEffect, useState } from 'react';

import { useAppServices } from './services-context';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;

const MB = 1024 * 1024;

/**
 * The dropped file's handle, so Save can write back to it. It must be asked for before the drop
 * handler's first await. Electron's main denies file-system permission, so there it stays absent.
 */
function droppedHandle(event: DragEvent): Promise<FileSystemHandle | null> {
  const item = event.dataTransfer?.items[0];
  if (window.reprise || item?.kind !== 'file' || !item.getAsFileSystemHandle) {
    return Promise.resolve(null);
  }
  return item.getAsFileSystemHandle().catch(() => null);
}

/** Drag and drop anywhere in the window opens the first dropped file. */
export function DropZone() {
  const { document } = useAppServices();
  const [over, setOver] = useState(false);

  useEffect(() => {
    // Enter and leave fire for every child crossed; the count is zero only outside the window.
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        document
          .getState()
          .failOpen(
            file.name,
            `The file is ${String(Math.ceil(file.size / MB))} MB; the limit is ${String(Math.floor(MAX_FILE_BYTES / MB))} MB`,
            'too-large',
          );
        return;
      }
      const handle = droppedHandle(event);
      void Promise.all([file.arrayBuffer(), handle]).then(
        ([buffer, picked]) =>
          document
            .getState()
            .openBytes(
              file.name,
              new Uint8Array(buffer),
              picked?.kind === 'file' ? picked : undefined,
            ),
        (error: unknown) => {
          document
            .getState()
            .failOpen(file.name, error instanceof Error ? error.message : String(error));
        },
      );
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [document]);

  if (!over) return null;
  return (
    <div
      aria-hidden
      className="bg-background/70 pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <div className="border-primary text-foreground flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed text-lg font-medium">
        Drop to open
      </div>
    </div>
  );
}
