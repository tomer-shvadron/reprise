import { CommandError } from '@reprise/model';

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The status-line text for a refused edit, or undefined when `error` is not a refusal (a bug,
 * which the caller rethrows). Shared by every editor command that applies a model command, so a
 * refusal reads the same wherever it comes from.
 */
export function describeRefusal(error: unknown): string | undefined {
  if (!(error instanceof CommandError)) return undefined;
  switch (error.code) {
    case 'voice-overfull':
      return 'That does not fit in the bar';
    case 'not-fretted':
      return 'Note entry works on fretted tracks only';
    case 'off-fretboard':
      return 'That fret is not on the neck';
    default: {
      // The model prefixes its message with the command name, which means nothing to a player.
      const prefix = `${error.command}: `;
      const text = error.message.startsWith(prefix)
        ? error.message.slice(prefix.length)
        : error.message;
      return sentence(text);
    }
  }
}
