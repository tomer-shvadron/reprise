/**
 * Builds small gpif documents for tests, in the shape Guitar Pro 7 writes them. Each helper
 * takes the inner XML it does not model as `extra`, so a test states only what it exercises.
 */

export const property = (name: string, inner: string): string =>
  `<Property name="${name}">${inner}</Property>`;

export function guitarTrack(
  id = '0',
  { extra = '', staffProperties = '', program = 25, pitches = '40 45 50 55 59 64' } = {},
): string {
  return `<Track id="${id}">
<Name><![CDATA[Guitar ${id}]]></Name>
<ShortName><![CDATA[gtr.]]></ShortName>
<Color>255 0 128</Color>
<InstrumentSet><Name>Guitar</Name><Type>steelGuitar</Type><LineCount>5</LineCount></InstrumentSet>
<Transpose><Chromatic>0</Chromatic><Octave>-1</Octave></Transpose>
<Sounds><Sound><Name>Steel</Name><Path>Guitars/Steel</Path><Role>Factory</Role>
<MIDI><LSB>0</LSB><MSB>0</MSB><Program>${String(program)}</Program></MIDI></Sound></Sounds>
<PlaybackState>Default</PlaybackState>
<Staves><Staff><Properties>
${property('CapoFret', '<Fret>0</Fret>')}
${property('FretCount', '<Number>24</Number>')}
${property('Tuning', `<Pitches>${pitches}</Pitches>`)}
${staffProperties}
</Properties></Staff></Staves>
${extra}
</Track>`;
}

/** A further `<Staff>` with its own tuning and capo, to splice before `</Staves>`. */
export const secondStaff = (pitches: string, capo = 0): string =>
  `<Staff><Properties>${property('CapoFret', `<Fret>${String(capo)}</Fret>`)}${property('Tuning', `<Pitches>${pitches}</Pitches>`)}</Properties></Staff>`;

export const masterBar = (bars: string, extra = '', time = '4/4'): string =>
  `<MasterBar><Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode></Key><Time>${time}</Time>${extra}<Bars>${bars}</Bars></MasterBar>`;

export const bar = (id: string, voices: string, extra = ''): string =>
  `<Bar id="${id}"><Clef>G2</Clef><Voices>${voices}</Voices>${extra}</Bar>`;

export const voice = (id: string, beats: string): string =>
  `<Voice id="${id}"><Beats>${beats}</Beats></Voice>`;

export const beat = (id: string, rhythm: string, notes = '', extra = ''): string =>
  `<Beat id="${id}"><Dynamic>MF</Dynamic><Rhythm ref="${rhythm}" />${notes === '' ? '' : `<Notes>${notes}</Notes>`}${extra}</Beat>`;

/** A fretted note; `string` is gpif's index, 0 for the lowest string. */
export const note = (
  id: string,
  string: number,
  fret: number,
  extra = '',
  properties = '',
): string =>
  `<Note id="${id}">${extra}<Properties>${property('String', `<String>${String(string)}</String>`)}${property('Fret', `<Fret>${String(fret)}</Fret>`)}${properties}</Properties></Note>`;

export const rhythm = (id: string, value: string, extra = ''): string =>
  `<Rhythm id="${id}"><NoteValue>${value}</NoteValue>${extra}</Rhythm>`;

export const tempo = (bar: number, position: number, value: string, linear = false): string =>
  `<Automation><Type>Tempo</Type><Linear>${String(linear)}</Linear><Bar>${String(bar)}</Bar><Position>${String(position)}</Position><Visible>true</Visible><Value>${value}</Value></Automation>`;

export interface GpifParts {
  tracks?: string[];
  trackOrder?: string;
  automations?: string[];
  masterBars: string[];
  bars: string[];
  voices: string[];
  beats: string[];
  notes?: string[];
  rhythms: string[];
  /** Extra children of the root, after the standard sections. */
  root?: string;
  score?: string;
}

export function gpif(parts: GpifParts): string {
  const tracks = parts.tracks ?? [guitarTrack()];
  const automations = parts.automations ?? [tempo(0, 0, '120 2')];
  return `<?xml version="1.0" encoding="utf-8"?>
<GPIF>
<GPVersion>7</GPVersion>
<Score><Title><![CDATA[Test]]></Title>${parts.score ?? ''}</Score>
<MasterTrack><Tracks>${parts.trackOrder ?? tracks.map((_, index) => String(index)).join(' ')}</Tracks>
<Automations>${automations.join('\n')}</Automations></MasterTrack>
<Tracks>${tracks.join('\n')}</Tracks>
<MasterBars>${parts.masterBars.join('\n')}</MasterBars>
<Bars>${parts.bars.join('\n')}</Bars>
<Voices>${parts.voices.join('\n')}</Voices>
<Beats>${parts.beats.join('\n')}</Beats>
<Notes>${(parts.notes ?? []).join('\n')}</Notes>
<Rhythms>${parts.rhythms.join('\n')}</Rhythms>
${parts.root ?? ''}
</GPIF>`;
}

/** One track, one bar, one voice of the given beats: the common case. */
export function oneBar(
  beats: string[],
  notes: string[],
  rhythms: string[],
  extra: Partial<GpifParts> = {},
): string {
  const ids = beats.map((_, index) => String(index)).join(' ');
  return gpif({
    masterBars: [masterBar('0')],
    bars: [bar('0', '0 -1 -1 -1')],
    voices: [voice('0', ids)],
    beats,
    notes,
    rhythms,
    ...extra,
  });
}
