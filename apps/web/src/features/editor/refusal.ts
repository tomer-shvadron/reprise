import { CommandError } from '@reprise/model';

/**
 * A plain sentence for a refused command. WP-081 owns the shared `describeRefusal`; this covers the
 * refusals track and bar edits can meet until the two are merged, then it is deleted.
 */
export function refusalMessage(error: unknown): string {
  if (error instanceof CommandError) {
    if (error.code === 'last-track') return 'A score keeps at least one track.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
