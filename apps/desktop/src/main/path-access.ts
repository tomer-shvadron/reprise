import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Which paths the renderer may read and write: anything under the app's own directories, plus
 * files the user picked in a native dialog. A compromised renderer cannot reach the rest of disk.
 */
export class PathAccess {
  readonly #roots: readonly string[];
  readonly #granted = new Set<string>();

  constructor(roots: readonly string[]) {
    this.#roots = roots.map((root) => resolve(root));
  }

  grant(path: string): void {
    this.#granted.add(resolve(path));
  }

  allows(path: string): boolean {
    const target = resolve(path);
    if (this.#granted.has(target)) return true;
    return this.#roots.some((root) => {
      const rel = relative(root, target);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
  }
}
