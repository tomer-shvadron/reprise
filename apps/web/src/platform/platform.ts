import type { FileFilter, FileHandle, OpenedFile, PrintOptions } from './bridge';

export type { FileFilter, FileHandle, OpenedFile, PrintOptions } from './bridge';

export interface Platform {
  /** Resolves undefined when the user cancels. */
  openFile(filters: readonly FileFilter[]): Promise<OpenedFile | undefined>;
  /**
   * Resolves a path `writeFile` can write to again, or undefined when the user cancels or the
   * platform cannot name one (a browser download).
   */
  saveFile(
    suggestedName: string,
    bytes: Uint8Array,
    filters: readonly FileFilter[],
  ): Promise<string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Writes over a file `openFile` returned the handle of, or a path `saveFile` returned. */
  writeHandle(handle: FileHandle, bytes: Uint8Array): Promise<void>;
  /** ~/Music/Reprise on desktop; a directory in origin-private storage in the browser. */
  libraryDir(): Promise<string>;
  /** Electron userData on desktop; a directory in origin-private storage in the browser. */
  dataDir(): Promise<string>;
  /** Opens the system print dialog, on `options.pageSize` where the platform can preselect it. */
  print(options?: PrintOptions): Promise<void>;
  microphone(): Promise<MediaStream>;
}
