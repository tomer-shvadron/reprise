import type { SfzFiles } from '@reprise/audio';

/** One instrument of an installed pack: a key a track names in `sound.instrument`. */
export interface InstalledInstrument {
  key: string;
  name: string;
  /** SFZ paths in the pack by articulation-set key; `default` is required to play. */
  entries: Readonly<Record<string, string>>;
}

/** An installed sound pack as the audio service sees it. */
export interface InstalledPackSource {
  /** The id a track's `sound.packId` names; no slash. */
  id: string;
  name: string;
  /** The same object for as long as the installed version lives: a new object reloads its tracks. */
  files: SfzFiles;
  /** The first one plays for a track that names no `sound.instrument`. */
  instruments: readonly InstalledInstrument[];
}

/** What the audio service reads installed packs from. */
export interface PackDirectory {
  get(id: string): InstalledPackSource | undefined;
  /** Fires after the installed set changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}
