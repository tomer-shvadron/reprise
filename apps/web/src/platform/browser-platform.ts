import { NotImplementedError, type FileFilter, type OpenedFile, type Platform } from './platform';

function acceptAttribute(filters: readonly FileFilter[]): string {
  return filters.flatMap(({ extensions }) => extensions.map((ext) => `.${ext}`)).join(',');
}

function pickFile(filters: readonly FileFilter[]): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptAttribute(filters);
    input.addEventListener('change', () => {
      resolve(input.files?.[0]);
    });
    input.addEventListener('cancel', () => {
      resolve(undefined);
    });
    input.click();
  });
}

export const browserPlatform: Platform = {
  async openFile(filters): Promise<OpenedFile | undefined> {
    const file = await pickFile(filters);
    if (!file) return undefined;
    return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  },
  saveFile: () => Promise.reject(new NotImplementedError('saveFile')),
  readFile: () => Promise.reject(new NotImplementedError('readFile')),
  writeFile: () => Promise.reject(new NotImplementedError('writeFile')),
  libraryDir: () => Promise.reject(new NotImplementedError('libraryDir')),
  dataDir: () => Promise.reject(new NotImplementedError('dataDir')),
  print: () => Promise.reject(new NotImplementedError('print')),
  microphone: () => Promise.reject(new NotImplementedError('microphone')),
};
