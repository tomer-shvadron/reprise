import type { SfzReader } from './preprocess';

/** An in-memory pack for the tests: the text of each file by pack-relative path. */
export function memoryReader(files: Readonly<Record<string, string>>): SfzReader {
  return (path) => {
    const text = files[path];
    return text === undefined
      ? Promise.reject(new Error(`No file ${path}`))
      : Promise.resolve(new TextEncoder().encode(text));
  };
}
