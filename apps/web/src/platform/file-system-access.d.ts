// The File System Access pickers ship in Chromium only, so TypeScript's DOM lib omits them.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  /** OPFS and recent Chromium only; absent elsewhere, where a copy and a delete stand in. */
  move?: (destination: FileSystemDirectoryHandle, name: string) => Promise<void>;
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
