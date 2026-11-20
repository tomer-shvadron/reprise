import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useAppServices } from '@/app/services-context';
import { libraryOf } from '@/features/library';

import { StatusSegment } from './segment';
import { libraryLabel, savedLabel } from './status-text';

/** Whether the song is saved; a click saves, or runs Save As for a song with no file. */
export function SavedSegment() {
  const { document } = useAppServices();
  const state = useStore(
    document,
    useShallow((s) => ({ hasScore: s.score !== undefined, dirty: s.dirty, saving: s.saving })),
  );
  const text = savedLabel(state);
  if (text === undefined) return null;
  return (
    <StatusSegment command="file.save" label="Save the song">
      {text}
    </StatusSegment>
  );
}

/** Whether the open song is in the library, or the import's progress; a click opens the library. */
export function LibrarySegment() {
  const services = useAppServices();
  const importer = useStore(
    libraryOf(services).importer.store,
    useShallow((s) => ({ phase: s.phase, total: s.total, done: s.done })),
  );
  const song = useStore(
    services.document,
    useShallow((s) => ({
      hasScore: s.score !== undefined,
      songId: s.songId,
      hasFile: s.file !== undefined,
    })),
  );
  const text = libraryLabel({ ...song, importer });
  if (text === undefined) return null;
  // The library is also the header's crumb, so a narrow window drops this one first.
  return (
    <StatusSegment command="library.show" label="Show the library" className="@max-[60rem]:hidden">
      {text}
    </StatusSegment>
  );
}
