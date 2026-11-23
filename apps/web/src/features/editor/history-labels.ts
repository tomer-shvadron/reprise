/**
 * The readable name of a history step. The model records the command's own name (`insertBar`) or a
 * chain's (`pasteBars`, `enterNote`); the Undo item, the palette and the history panel show this
 * instead.
 */
// A Map, not an object: effect chains pass free text, and `constructor` must not find a function.
const LABELS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // Note entry (chain names from entry.ts).
    enterNote: 'Enter note',
    enterRest: 'Enter rest',
    setRhythm: 'Change duration',
    toggleTie: 'Toggle tie',
    deleteNote: 'Delete note',
    deleteBeat: 'Delete beat',
    appendBar: 'Add bar',
    // Bars.
    insertBar: 'Insert bar',
    removeBar: 'Delete bar',
    deleteBars: 'Delete bars',
    setMasterBar: 'Bar properties',
    setMasterBars: 'Bar properties',
    // Tracks.
    setTrackProperties: 'Track properties',
    addTrack: 'Add track',
    removeTrack: 'Remove track',
    moveTrack: 'Move track',
    // Clipboard.
    pasteBars: 'Paste',
    pasteBeats: 'Paste',
    cutBars: 'Cut',
    cutBeats: 'Cut',
    // Raw model commands that can reach history on their own.
    insertBeat: 'Insert beat',
    removeBeat: 'Delete beat',
    removeNote: 'Delete note',
    setNote: 'Edit note',
    setBeatDuration: 'Change duration',
    setBeatDurations: 'Change duration',
    setBeatRest: 'Toggle rest',
    setNoteEffect: 'Change note effect',
    setNoteEffects: 'Change note effects',
    setBeatEffect: 'Change beat effect',
    setBeatEffects: 'Change beat effects',
    replaceBeats: 'Edit beats',
    shiftStrings: 'Move to next string',
    transposeSelection: 'Transpose',
    respell: 'Respell',
    // Word entry (WP-085): chain names that are already the label, listed so this stays the one place.
    'Chord name': 'Chord name',
    Text: 'Text',
    Lyrics: 'Lyrics',
  }),
);

/** `insertBar` to `Insert bar`; text that already has a space or no capitals only gets its first letter raised. */
function sentenceCase(name: string): string {
  const words = /\s/.test(name)
    ? name
    : name
        .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
        .replaceAll(/[._-]+/g, ' ')
        .toLowerCase();
  const trimmed = words.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * The display label of a command name. A name already written as text, such as an effect's
 * "palm mute", is kept (capitalised); any other id is turned into sentence case.
 */
export function historyLabel(name: string): string {
  return LABELS.get(name) ?? sentenceCase(name);
}
