export const COPYRIGHT = 'Copyright © 2026 Tomer Shvadron';

/** The macOS About panel's fields; `app.getVersion()` is the packaged package.json version. */
export function aboutPanelOptions(version: string) {
  return { applicationName: 'Reprise', applicationVersion: version, copyright: COPYRIGHT };
}

export interface RuntimeVersions {
  electron?: string | undefined;
  chrome?: string | undefined;
  node?: string | undefined;
}

/** The Windows About box body: the app version, then the runtime it is built on. */
export function aboutDetail(version: string, versions: RuntimeVersions): string {
  const runtime = (
    [
      ['Electron', versions.electron],
      ['Chromium', versions.chrome],
      ['Node.js', versions.node],
    ] as const
  ).flatMap(([name, value]) => (value ? [`${name} ${value}`] : []));
  return [`Version ${version}`, ...runtime, '', COPYRIGHT].join('\n');
}
