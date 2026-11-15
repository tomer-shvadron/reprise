export interface MediaPermissionDetails {
  mediaTypes?: readonly string[] | undefined;
}

export interface MediaPermissionDeps {
  platform: NodeJS.Platform;
  /** macOS's own prompt; resolves to whether the user allowed it. */
  askForMicrophone: () => Promise<boolean>;
}

/**
 * Whether the page may have the permission it asked for: only a microphone request, never the
 * camera or anything else. On macOS the system asks (or reports its stored answer) first.
 */
export async function decideMediaPermission(
  permission: string,
  details: MediaPermissionDetails,
  { platform, askForMicrophone }: MediaPermissionDeps,
): Promise<boolean> {
  const types = details.mediaTypes ?? [];
  const audioOnly =
    permission === 'media' && types.length > 0 && types.every((type) => type === 'audio');
  if (!audioOnly) return false;
  if (platform !== 'darwin') return true;
  try {
    return await askForMicrophone();
  } catch {
    return false;
  }
}
