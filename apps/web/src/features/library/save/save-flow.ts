import { write as writeScore } from '@reprise/formats';
import { newId, type Id } from '@reprise/model';

import { contentKey, type DocumentStore, type DocumentFile, type Saver } from '@/state/document';

import type { SongsRepository } from '../db/repository';
import type { SongRow } from '../db/rows';
import type { LibraryFiles } from '../files';
import { summarize } from '../import/parse-import';
import { newSongRow, stem } from '../import/song-row';
import { LIBRARY_PREFIX } from '../paths';

export interface SaveFlowDeps {
  document: DocumentStore;
  repo: SongsRepository;
  files: LibraryFiles;
  now: () => number;
  /** A song joined the library on its first Save. */
  onAdded(row: SongRow): void;
  /** A song's row changed (its summary and `savedAt`). */
  onUpdated(row: SongRow): void;
  /** The document now is this library song: start keeping its session. */
  onJoined(id: Id): void;
  /** Tells the user, without blocking, why Save did something other than they asked. */
  notify(message: string): void;
  write?: typeof writeScore;
}

const FORMAT_LABEL: Record<string, string> = {
  gp3: 'Guitar Pro 3',
  gp4: 'Guitar Pro 4',
  gp5: 'Guitar Pro 5',
  gpx: 'Guitar Pro 6',
};

/** The file's handle is a library path: for a document with no `songId`, a deleted song's. */
export function pointsIntoLibrary(file: DocumentFile | undefined): boolean {
  return typeof file?.handle === 'string' && file.handle.startsWith(LIBRARY_PREFIX);
}

/** What Save can write in place to the file's own handle: `.reprise` or `.gp`, with a handle. */
function writableInPlace(file: DocumentFile | undefined): boolean {
  return (
    file?.handle !== undefined &&
    !pointsIntoLibrary(file) &&
    (file.format === 'reprise' || file.format === 'gp')
  );
}

/** Why Save became Save As, in a sentence a person can act on. */
export function fallthroughMessage(file: DocumentFile): string {
  if (pointsIntoLibrary(file)) {
    return `“${file.name}” is no longer in your library, so Save became Save As.`;
  }
  const label = FORMAT_LABEL[file.format];
  if (label !== undefined) {
    return `Reprise can't write ${label} files, so Save became Save As, which writes a .reprise file. Use Export as Guitar Pro for a .gp.`;
  }
  return `“${file.name}” has no file to save to, so Save became Save As.`;
}

/**
 * The library's Save and Save As, installed with `setSaver`. Save writes where the rules in the
 * WP-061 plan say: a library song to its native (never the original), a file opened without
 * importing to its own path (the built-in, with its Guitar Pro loss prompt), a document with no
 * file at all into the library, and anything else to Save As. Save As is the built-in: it writes
 * `.reprise` anywhere and detaches the document from its song.
 */
export function createLibrarySaver(deps: SaveFlowDeps): Saver {
  const { document, repo, files, now, write = writeScore } = deps;

  const saveToSong = async (row: SongRow) => {
    const mark = document.getState().beginSave();
    if (!mark) return;
    const name = `${stem(row.originalName)}.reprise`;
    try {
      const { bytes } = await write(mark.score, 'reprise');
      const savedKey = await contentKey(bytes);
      await files.writeNative(row, bytes);
      document.getState().finishSave(mark, {
        saved: { name, format: 'reprise', handle: row.nativePath, savedKey },
      });
      const meta = summarize(mark.score);
      const patch = {
        title: meta.title.trim() === '' ? row.title : meta.title,
        artist: meta.artist,
        album: meta.album,
        bars: meta.bars,
        tracks: meta.tracks,
        savedAt: now(),
      };
      // The file is saved by now: a row that cannot be updated costs only a stale list entry.
      try {
        if (await repo.update(row.id, patch)) deps.onUpdated({ ...row, ...patch });
      } catch (error) {
        console.warn('Saved the song but could not update its library row', error);
      }
    } catch (error) {
      document.getState().finishSave(mark, { failed: error, fileName: name });
    }
  };

  const addToLibrary = async () => {
    const mark = document.getState().beginSave();
    if (!mark) return;
    const id = newId();
    const meta = summarize(mark.score);
    const title = meta.title.trim() === '' ? 'Untitled' : meta.title.trim();
    const name = `${title}.reprise`;
    try {
      const { bytes } = await write(mark.score, 'reprise');
      const savedKey = await contentKey(bytes);
      const row = newSongRow({
        id,
        name,
        format: 'reprise',
        key: savedKey,
        meta,
        now: now(),
        opened: true,
        hasOriginal: false,
      });
      const added = { ...row, savedAt: row.importedAt };
      await files.write(added, bytes, undefined);
      try {
        await repo.add(added);
      } catch (error) {
        await files.discard(added);
        throw error;
      }
      document.getState().finishSave(mark, {
        saved: { name, format: 'reprise', handle: added.nativePath, savedKey },
        songId: id,
      });
      deps.onAdded(added);
      // Whether or not the document is still open, the song is in the library; only an open
      // document is kept by a session keeper.
      if (document.getState().songId === id) deps.onJoined(id);
    } catch (error) {
      document.getState().finishSave(mark, { failed: error, fileName: name });
    }
  };

  // The saver looks the song up before it begins a save, so `saving` is not yet set while it
  // waits; this keeps a second Save during that wait from starting another.
  let running = false;
  const once = async (run: () => Promise<void>) => {
    if (running) return;
    running = true;
    try {
      await run();
    } finally {
      running = false;
    }
  };

  const saver: Saver = {
    save: (builtin) => once(() => save(builtin)),
    saveAs: (builtin) => once(builtin),
  };

  async function save(builtin: () => Promise<void>): Promise<void> {
    const { songId, file, score } = document.getState();
    if (!score) return;
    if (songId !== undefined) {
      const row = await repo.get(songId);
      if (row) {
        await saveToSong(row);
        return;
      }
    }
    if (file === undefined) {
      await addToLibrary();
      return;
    }
    if (writableInPlace(file)) {
      await builtin();
      return;
    }
    deps.notify(fallthroughMessage(file));
    // The built-in save then finds nothing to write in place and asks for a place: it never
    // follows a library handle, and with no song id it cannot think the handle is a song's.
    if (songId !== undefined) document.getState().setSongId(undefined);
    await builtin();
  }
  return saver;
}
