import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Which paths the renderer may read and write: anything under the app's own directories, plus
 * files the user picked in a native dialog. A compromised renderer cannot reach the rest of disk.
 * Every path is compared by where it points, not where it sits, so a symlink planted inside a
 * root cannot lead out of it; the window between this check and the file operation is accepted.
 */
export class PathAccess {
  readonly #roots: readonly string[];
  readonly #granted = new Set<string>();

  constructor(roots: readonly string[]) {
    this.#roots = roots.map((root) => resolve(root));
  }

  grant(path: string): void {
    this.#granted.add(canonical(path));
  }

  allows(path: string): boolean {
    const target = canonical(path);
    if (this.#granted.has(target)) return true;
    return this.#roots.some((root) => isInside(canonical(root), target));
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function canonical(path: string): string {
  return realpathOf(resolve(path));
}

// A path that does not exist yet (a fresh writeFile) resolves through its deepest existing ancestor.
function realpathOf(absolute: string): string {
  try {
    return realpathSync.native(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(realpathOf(parent), basename(absolute));
  }
}
