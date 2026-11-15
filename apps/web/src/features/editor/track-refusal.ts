import { CommandError } from '@reprise/model';

/**
 * A plain sentence for a refused track command, without the model's "command: " prefix. WP-081
 * owns the shared `describeRefusal` (#239); once that lands this file is deleted and its callers
 * switch over.
 */
export function refusalMessage(error: unknown): string {
  if (error instanceof CommandError) {
    if (error.code === 'last-track') return 'A score keeps at least one track.';
    const prefix = `${error.command}: `;
    return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
