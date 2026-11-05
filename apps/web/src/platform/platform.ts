export interface FileFilter {
  name: string;
  /** Without the leading dot. */
  extensions: readonly string[];
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

export interface Platform {
  /** Resolves undefined when the user cancels. */
  openFile(filters: readonly FileFilter[]): Promise<OpenedFile | undefined>;
  /** Resolves the saved path, or undefined when the user cancels. */
  saveFile(
    suggestedName: string,
    bytes: Uint8Array,
    filters: readonly FileFilter[],
  ): Promise<string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** ~/Music/Reprise on desktop; the OPFS root in the browser. */
  libraryDir(): Promise<string>;
  /** Electron userData on desktop; OPFS in the browser. */
  dataDir(): Promise<string>;
  print(): Promise<void>;
  microphone(): Promise<MediaStream>;
}

export class NotImplementedError extends Error {
  constructor(method: keyof Platform) {
    super(`Platform.${method} is not implemented until WP-004`);
    this.name = 'NotImplementedError';
  }
}
