export interface MediaPermissionDetails {
  mediaTypes?: readonly string[] | undefined;
  /** The page asking, as Electron reports it. */
  requestingUrl?: string | undefined;
  isMainFrame?: boolean | undefined;
}

export interface MediaPermissionDeps {
  platform: NodeJS.Platform;
  /** Whether a URL is a page of the app itself. */
  isAppUrl: (url: string) => boolean;
  /** macOS's own prompt; resolves to whether the user allowed it. */
  askForMicrophone: () => Promise<boolean>;
}

/**
 * Whether the page may have the permission it asked for: only a microphone request, never the
 * camera or anything else, and only from the app's own top frame, not a subframe or a page
 * that is not ours. On macOS the system asks (or reports its stored answer) first.
 */
export async function decideMediaPermission(
  permission: string,
  details: MediaPermissionDetails,
  { platform, askForMicrophone, isAppUrl }: MediaPermissionDeps,
): Promise<boolean> {
  const types = details.mediaTypes ?? [];
  const audioOnly =
    permission === 'media' && types.length > 0 && types.every((type) => type === 'audio');
  if (!audioOnly) return false;
  if (details.isMainFrame !== true) return false;
  if (details.requestingUrl === undefined || !isAppUrl(details.requestingUrl)) return false;
  if (platform !== 'darwin') return true;
  try {
    return await askForMicrophone();
  } catch {
    return false;
  }
}
