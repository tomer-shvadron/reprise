import { CommandError, type ViolationRule } from '@reprise/model';

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** What a broken validation rule means to a player. Rules not listed fall back to the rule's own message. */
const RULES: Partial<Record<ViolationRule, string>> = {
  'voice-overfull': 'That does not fit in the bar',
  'fret-range': 'That fret is not on the neck',
  'string-range': 'That string is not on this track',
  'duplicate-string': 'That string already has a note',
  'tie-target': 'There is nothing to tie to',
  'tie-pitch': 'A tied note must keep the pitch of the note it continues',
  tuplet: 'That tuplet is not allowed',
  dots: 'That many dots is not allowed',
  'first-bar-tempo': 'The first bar always has a tempo',
  'alternate-ending-outside-repeat':
    'An alternate ending needs a repeat end in its run of endings: add one to the last bar of ending 1',
  'alternate-ending-order': 'Alternate endings must follow each other in order',
};

/** The model prefixes its messages with the command name, and an invariant adds a path: neither means anything to a player. */
function plain(error: CommandError): string {
  const prefix = `${error.command}: `;
  const text = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
  return sentence(text.replace(/^[a-z-]+ at [\w.]+: /, ''));
}

/**
 * The status-line text for a refused edit, or undefined when `error` is not a refusal (a bug,
 * which the caller rethrows). Shared by every editor command that applies a model command, so a
 * refusal reads the same wherever it comes from. Beat and note commands refuse through the
 * `invariant` code with the broken rule in `violations`, bar commands with their own codes; both
 * are mapped.
 */
export function describeRefusal(error: unknown): string | undefined {
  if (!(error instanceof CommandError)) return undefined;
  switch (error.code) {
    case 'voice-overfull':
      // A bar edit cuts the room notes already fill; an entry just has no room left.
      return error.command.startsWith('setMasterBar')
        ? 'A smaller time signature cannot hold the notes already in the bar: shorten or delete them first'
        : RULES['voice-overfull'];
    case 'not-fretted':
      return 'Note entry works on fretted tracks only';
    case 'off-fretboard':
      return RULES['fret-range'];
    case 'string-occupied':
      return RULES['duplicate-string'];
    case 'invariant': {
      const [violation] = error.violations;
      if (!violation) return plain(error);
      return RULES[violation.rule] ?? sentence(violation.message);
    }
    default:
      return plain(error);
  }
}
