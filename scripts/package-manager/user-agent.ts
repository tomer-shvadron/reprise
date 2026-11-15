/** The package manager named first in `npm_config_user_agent`, as `pnpm/11.4.0 npm/? node/...`. */
export function packageManagerOf(userAgent: string | undefined): string | undefined {
  const name = userAgent?.trim().split('/')[0];
  return name === '' ? undefined : name;
}

/**
 * Why an install must stop, or undefined when pnpm runs it. An unset user agent passes: only a
 * package manager sets it, and a script run by hand is not an install.
 */
export function packageManagerProblem(
  userAgent: string | undefined,
  pinned: string | undefined,
): string | undefined {
  const manager = packageManagerOf(userAgent);
  if (manager === undefined || manager === 'pnpm') return undefined;
  return [
    `Reprise is a pnpm workspace (package.json pins ${pinned ?? 'pnpm'}); this install was started by ${manager}.`,
    `Delete the node_modules and lockfile ${manager} may have written, run \`corepack enable pnpm\``,
    'once (bundled with Node 24), then `pnpm bootstrap` on a fresh checkout or `pnpm install`.',
  ].join('\n');
}
