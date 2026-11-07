/**
 * The owner's listening sheet: one row per checklist item the file needs, linked to its section
 * of `docs/reference/player-checklist.md`. A test keeps the anchors and the feature keys of
 * `packages/formats/test/files-check/read-facts.ts` in step with this table.
 */
import type { ListeningFeature } from './meta.ts';

export const CHECKLIST = 'docs/reference/player-checklist.md';

export interface ListeningItem {
  title: string;
  /** A heading of the checklist, as GitHub slugs it. */
  anchor: string;
  listenFor: string;
}

/** Rows every sheet carries, whatever the file holds. */
export const ALWAYS: readonly ListeningItem[] = [
  {
    title: 'B1 Opens',
    anchor: 'b1-opens',
    listenFor: 'opens; import details match the Read section; names, instruments, tunings',
  },
  {
    title: 'B2 Order',
    anchor: 'b2-order',
    listenFor: 'the cursor follows the Order section of the report',
  },
  {
    title: 'B3 Tempo',
    anchor: 'b3-tempo',
    listenFor: 'changes at the listed bars; ramps glide; the BPM readout follows',
  },
  {
    title: 'B7 Looking',
    anchor: 'b7-looking',
    listenFor: 'nothing overlaps or is cut, in tab, standard and both',
  },
];

const effect = (title: string, listenFor: string): ListeningItem => ({
  title,
  anchor: 'b4-effects',
  listenFor,
});
const order = (title: string, listenFor: string): ListeningItem => ({
  title,
  anchor: 'b2-order',
  listenFor,
});

export const FEATURES: Readonly<Record<string, ListeningItem>> = {
  'tempo-change': {
    title: 'Tempo changes',
    anchor: 'b3-tempo',
    listenFor: 'the tempo steps at the bar',
  },
  'tempo-ramp': {
    title: 'Tempo ramps',
    anchor: 'b3-tempo',
    listenFor: 'the tempo glides over the ramp',
  },
  repeats: order('Repeats', 'each repeated section plays its written number of times'),
  'alternate-endings': order('Alternate endings', 'each pass takes its own ending'),
  jumps: order('Jumps (D.C., D.S., coda, fine)', 'the jump lands where the report says'),
  'time-signature-change': order('Time signature changes', 'the bar lasts its new length'),
  'key-change': {
    title: 'Key changes',
    anchor: 'b7-looking',
    listenFor: 'the key signature is drawn at the change',
  },
  'triplet-feel': effect('Triplet feel', 'pairs played long-short'),
  bends: effect('Bends', 'glides to the target within the note; releases glide back'),
  whammy: effect('Whammy bar', "the beat's pitch moves smoothly by the written amount"),
  vibrato: effect('Vibrato', 'an even wobble; wide is deeper'),
  slides: effect(
    'Slides',
    'shift slides strike again, legato slides do not; slides in and out glide',
  ),
  'hammer-ons': effect('Hammer-ons and pull-offs', 'the second note sounds without a pick attack'),
  harmonics: effect('Harmonics', 'a bell or glassy tone at the written harmonic'),
  trills: effect('Trills', 'fast alternation with the written note'),
  'grace-notes': effect('Grace notes', 'a quick note just before the beat'),
  'palm-mute': effect('Palm mute', 'short and damped'),
  'let-ring': effect('Let ring', 'keeps sounding under later notes'),
  'dead-notes': effect('Dead notes', 'a percussive click with no pitch'),
  'ghost-notes': effect('Ghost notes', 'clearly quieter'),
  accents: effect('Accents', 'louder; heavy louder still'),
  staccato: effect('Staccato', 'shortened'),
  dynamics: effect('Dynamics', 'the level steps at each mark'),
  'tremolo-picking': effect('Tremolo picking', 'rapid repeats at the written value'),
  strokes: effect('Brush and arpeggio strokes', 'spread; down is low to high'),
  'tapping-slapping-popping': effect('Tapping, slapping, popping', 'played as notes'),
  fades: effect('Fades and volume swells', 'volume ramps across the note'),
  ties: effect('Ties', 'one sustained note; struck again after a repeat jump back'),
  'multiple-voices': {
    title: 'Multiple voices',
    anchor: 'b7-looking',
    listenFor: 'both voices sound and are drawn apart',
  },
  drums: { title: 'Drums', anchor: 'b5-drums', listenFor: 'every piece sounds as itself' },
  'pitched-non-fretted': {
    title: 'Pitched tracks without tab',
    anchor: 'b6-tracks',
    listenFor: 'plays at pitch; drawn on a standard staff',
  },
  'mixer-changes': effect('Mixer changes', 'the instrument, volume or pan changes at the bar'),
  'multiple-tracks': {
    title: 'Tracks',
    anchor: 'b6-tracks',
    listenFor: 'a sensible balance between tracks',
  },
  'muted-or-solo-tracks': {
    title: 'Mute and solo in the file',
    anchor: 'b6-tracks',
    listenFor: 'the stored mute and solo flags are respected',
  },
  lyrics: {
    title: 'Lyrics',
    anchor: 'b7-looking',
    listenFor: 'lyrics sit under their beats without overlapping',
  },
  'chord-diagrams': {
    title: 'Chord diagrams',
    anchor: 'b7-looking',
    listenFor: 'names and diagrams drawn above their beats',
  },
};

const cell = (text: string): string => text.replaceAll('|', '\\|');

/** The sheet for one file; `checklistLink` is the checklist's path relative to the sheet. */
export function listeningSheet(
  heading: string,
  features: readonly ListeningFeature[],
  checklistLink: string,
): string {
  const rows = [
    ...ALWAYS.map((item) => ({ item, bars: '', detail: '' })),
    ...features.flatMap((feature) => {
      const item = FEATURES[feature.key];
      return item ? [{ item, bars: feature.bars.join(', '), detail: feature.detail ?? '' }] : [];
    }),
  ];
  return [
    `# Listening sheet: ${heading}`,
    '',
    `Mark each row \`pass\`, \`fail\` or \`n/a\`; for a fail, put the bar and what you heard in Note. See [the checklist](${checklistLink}).`,
    '',
    '| Item | Bars | Listen for | Result | Note |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(({ item, bars, detail }) => {
      const listen = detail === '' ? item.listenFor : `${item.listenFor} (${detail})`;
      return `| [${item.title}](${checklistLink}#${item.anchor}) | ${bars} | ${cell(listen)} |  |  |`;
    }),
    '',
  ].join('\n');
}
