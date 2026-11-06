// The File System Access pickers ship in Chromium only, so TypeScript's DOM lib omits them.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: false;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
}

interface Window {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
