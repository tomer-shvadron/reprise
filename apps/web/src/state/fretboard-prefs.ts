export const LEFT_HANDED_STORAGE_KEY = 'reprise.fretboardLeftHanded';

export function readStoredLeftHanded(storage: () => Storage = () => window.localStorage): boolean {
  try {
    return storage().getItem(LEFT_HANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStoredLeftHanded(
  leftHanded: boolean,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(LEFT_HANDED_STORAGE_KEY, leftHanded ? '1' : '0');
  } catch {
    // Storage can be disabled or full; the setting still applies for this session.
  }
}
