import type { Format } from '@reprise/formats';
import type { Id } from '@reprise/model';

import type { SongRow } from '../db/rows';
import { nativePathOf, originalPathOf } from '../paths';
import type { ScoreSummary } from './parse-import';
import { safeName } from './safe-name';

export function stem(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface NewSongRow {
  id: Id;
  /** The file's name as the user knows it. */
  name: string;
  format: Format;
  key: string;
  meta: ScoreSummary;
  now: number;
  /** A song imported by opening it counts as opened. */
  opened?: boolean;
  /** False for a song that began in Reprise: no original file, so no `originalPath`. */
  hasOriginal?: boolean;
}

export function newSongRow({
  id,
  name,
  format,
  key,
  meta,
  now,
  opened,
  hasOriginal = true,
}: NewSongRow): SongRow {
  const originalName = name.split('/').pop() ?? name;
  return {
    id,
    title: meta.title.trim() === '' ? stem(name) : meta.title,
    artist: meta.artist,
    album: meta.album,
    sourceFormat: format,
    nativePath: nativePathOf(id),
    ...(hasOriginal && { originalPath: originalPathOf(id, safeName(originalName)) }),
    originalName,
    originalKey: key,
    importedAt: now,
    ...(opened && { lastOpenedAt: now }),
    bars: meta.bars,
    tracks: meta.tracks,
  };
}
