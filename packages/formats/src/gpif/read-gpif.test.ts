import { ScoreSchema, type Beat, type Note, type Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { GpifError } from './errors';
import { readGpif, type GpifReadResult } from './read-gpif';
import {
  bar,
  beat,
  gpif,
  guitarTrack,
  masterBar,
  note,
  oneBar,
  property,
  rhythm,
  tempo,
  voice,
} from './test/gpif-builder';

function read(xml: string, partConfiguration?: Uint8Array): GpifReadResult {
  const result = readGpif(xml, partConfiguration ? { partConfiguration } : {});
  // Whatever the reader produces must be a valid model score.
  ScoreSchema.parse(result.score);
  return result;
}

const beatsOf = (score: Score, barIndex = 0, voiceIndex = 0, track = 0): Beat[] =>
  score.tracks[track]?.bars[barIndex]?.voices[voiceIndex]?.beats ?? [];

const firstNote = (score: Score): Note | undefined => beatsOf(score)[0]?.notes[0];

const codes = (result: GpifReadResult): string[] => result.warnings.map((warning) => warning.code);

const QUARTERS = [rhythm('0', 'Quarter')];

describe('notes', () => {
  it('flips gpif string indexes to the model numbering and keeps the tuning low to high', () => {
    const { score } = read(
      oneBar([beat('0', '0', '0 1')], [note('0', 0, 3), note('1', 5, 0)], QUARTERS),
    );
    expect(score.tracks[0]?.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    expect(beatsOf(score)[0]?.notes.map((n) => [n.string, n.fret])).toEqual([
      [6, 3],
      [1, 0],
    ]);
  });

  it('reads note effects', () => {
    const effects = [
      '<LetRing />',
      '<Vibrato>Wide</Vibrato>',
      '<AntiAccent>Normal</AntiAccent>',
      '<Accent>9</Accent>',
      '<LeftFingering>I</LeftFingering>',
      '<RightFingering>P</RightFingering>',
      // A MIDI value: gpif string 2 is D3 (50), so this trills to fret 7.
      '<Trill>57</Trill>',
    ].join('');
    const properties = [
      property('PalmMuted', '<Enable />'),
      property('Muted', '<Enable />'),
      property('Slide', '<Flags>18</Flags>'),
      property('HarmonicType', '<HType>Artificial</HType>'),
      property('HarmonicFret', '<HFret>12</HFret>'),
      property(
        'ConcertPitch',
        '<Pitch><Step>F</Step><Accidental>#</Accidental><Octave>4</Octave></Pitch>',
      ),
    ].join('');
    const { score } = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5, effects, properties)], QUARTERS),
    );
    expect(firstNote(score)).toMatchObject({
      letRing: true,
      vibrato: 'wide',
      ghost: true,
      staccato: true,
      accent: 'accent',
      leftHandFinger: 'index',
      rightHandFinger: 'thumb',
      trill: { fret: 7, speed: 16 },
      palmMute: true,
      dead: true,
      slide: ['legato', 'intoFromBelow'],
      harmonic: { kind: 'artificial', value: 12 },
      accidental: 'sharp',
      dynamics: 'mf',
    });
  });

  it('reads bends as point lists in model units', () => {
    const properties = [
      property('Bended', '<Enable />'),
      property('BendOriginValue', '<Float>0</Float>'),
      property('BendOriginOffset', '<Float>0</Float>'),
      property('BendMiddleValue', '<Float>100</Float>'),
      property('BendMiddleOffset1', '<Float>25</Float>'),
      property('BendMiddleOffset2', '<Float>50</Float>'),
      property('BendDestinationValue', '<Float>0</Float>'),
      property('BendDestinationOffset', '<Float>100</Float>'),
    ].join('');
    const { score } = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5, '', properties)], QUARTERS),
    );
    expect(firstNote(score)?.bend).toEqual({
      kind: 'bendRelease',
      points: [
        { position: 0, value: 0 },
        { position: 15, value: 4 },
        { position: 30, value: 4 },
        { position: 60, value: 0 },
      ],
    });
  });

  it('names a simple upward bend and a prebend release', () => {
    const bend = (origin: number, destination: number): string =>
      [
        property('Bended', '<Enable />'),
        property('BendOriginValue', `<Float>${String(origin)}</Float>`),
        property('BendDestinationValue', `<Float>${String(destination)}</Float>`),
      ].join('');
    const { score } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0', '1')],
        [note('0', 2, 5, '', bend(0, 50)), note('1', 3, 5, '', bend(100, 0))],
        QUARTERS,
      ),
    );
    expect(beatsOf(score).map((b) => b.notes[0]?.bend?.kind)).toEqual(['bend', 'prebendRelease']);
  });

  it('moves a hammer-on to its destination note and warns when there is none', () => {
    const origin = property('HopoOrigin', '<Enable />');
    const { score, warnings } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0', '1'), beat('2', '0', '2')],
        [note('0', 2, 5, '', origin), note('1', 2, 7), note('2', 4, 5, '', origin)],
        QUARTERS,
      ),
    );
    expect(beatsOf(score).map((b) => b.notes[0]?.hammerPull)).toEqual([false, true, false]);
    expect(warnings.filter((w) => w.code === 'hammer-pull-without-destination')).toHaveLength(1);
  });

  it('reads ties and gives every reference to a shared note its own id', () => {
    const { score } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0', '1'), beat('2', '0', '1')],
        [note('0', 2, 5), note('1', 2, 5, '<Tie origin="false" destination="true" />')],
        QUARTERS,
      ),
    );
    const notes = beatsOf(score).map((b) => b.notes[0]);
    expect(notes.map((n) => n?.tie)).toEqual([false, true, true]);
    expect(new Set(notes.map((n) => n?.id)).size).toBe(3);
  });

  it('resolves a trill against the capo on fretted tracks and keeps MIDI on pitched ones', () => {
    const trill = (value: number): string => `<Trill>${String(value)}</Trill>`;
    const capo = guitarTrack('0', { staffProperties: property('CapoFret', '<Fret>2</Fret>') });
    const fretted = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0', '1')],
        [note('0', 2, 5, trill(59)), note('1', 2, 5, trill(40))],
        QUARTERS,
        { tracks: [capo] },
      ),
    );
    expect(beatsOf(fretted.score).map((b) => b.notes[0]?.trill)).toEqual([
      { fret: 7, speed: 16 },
      undefined,
    ]);
    expect(fretted.warnings.map((w) => w.message)).toContain(
      'A trill to MIDI 40 has no fret on this string; dropped',
    );

    const piano = guitarTrack('0', { program: 0 });
    const pitched = read(
      oneBar(
        [beat('0', '0', '0')],
        [note('0', 2, 5, trill(62), property('Midi', '<Number>60</Number>'))],
        QUARTERS,
        { tracks: [piano] },
      ),
    );
    expect(firstNote(pitched.score)).toMatchObject({ fret: 60, trill: { fret: 62, speed: 16 } });
  });

  it('marks a beat with a tapped note as tapped', () => {
    const { score } = read(
      oneBar(
        [beat('0', '0', '0')],
        [note('0', 2, 5, '', property('Tapped', '<Enable />'))],
        QUARTERS,
      ),
    );
    expect(beatsOf(score)[0]?.effects.tapping).toBe(true);
  });
});

describe('beats and rhythms', () => {
  it('reads dots, tuplets and rests', () => {
    const { score } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '1'), beat('2', '1'), beat('3', '1')],
        [note('0', 2, 5)],
        [
          rhythm('0', 'Half', '<AugmentationDot count="1" />'),
          rhythm('1', 'Eighth', '<PrimaryTuplet num="3" den="2" />'),
        ],
      ),
    );
    expect(beatsOf(score).map((b) => [b.duration, b.dots, b.tuplet, b.rest])).toEqual([
      [2, 1, undefined, false],
      [8, 0, { n: 3, of: 2 }, true],
      [8, 0, { n: 3, of: 2 }, true],
      [8, 0, { n: 3, of: 2 }, true],
    ]);
  });

  it('attaches a run of grace beats to the beat they lead into', () => {
    const grace = '<GraceNotes>BeforeBeat</GraceNotes>';
    const { score } = read(
      oneBar(
        [beat('0', '1', '0', grace), beat('1', '1', '1', grace), beat('2', '0', '2')],
        [note('0', 2, 3), note('1', 2, 5), note('2', 2, 7)],
        [rhythm('0', 'Whole'), rhythm('1', '32nd')],
      ),
    );
    const beats = beatsOf(score);
    expect(beats).toHaveLength(1);
    expect(beats[0]?.grace?.map((g) => [g.duration, g.before, g.notes[0]?.fret])).toEqual([
      [32, true, 3],
      [32, true, 5],
    ]);
  });

  it('releases a tie on a grace note, which the model forbids', () => {
    const grace = '<GraceNotes>BeforeBeat</GraceNotes>';
    const { score, warnings } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '1', '1', grace), beat('2', '2', '0')],
        [note('0', 2, 5), note('1', 2, 5, '<Tie origin="false" destination="true" />')],
        [rhythm('0', 'Half'), rhythm('1', '32nd'), rhythm('2', 'Half')],
      ),
    );
    expect(beatsOf(score)[1]?.grace?.[0]?.notes[0]).toMatchObject({ fret: 5, tie: false });
    expect(warnings.map((w) => w.code)).toContain('grace-tie-released');
  });

  it('ties whole notes for a double whole note', () => {
    const { score, warnings } = read(
      gpif({
        masterBars: [masterBar('0', '', '8/4')],
        bars: [bar('0', '0 -1 -1 -1')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: [rhythm('0', 'DoubleWhole')],
      }),
    );
    const beats = beatsOf(score);
    expect(beats.map((b) => [b.duration, b.notes[0]?.tie])).toEqual([
      [1, false],
      [1, true],
    ]);
    expect(codes({ score, warnings })).toContain('long-note-tied');
  });

  it('reads beat effects, text and the whammy bar', () => {
    const extra = [
      '<FreeText>let it ring</FreeText>',
      '<Fadding>VolumeSwell</Fadding>',
      '<Tremolo>1/4</Tremolo>',
      '<Arpeggio>Up</Arpeggio>',
      '<Properties>',
      property('PickStroke', '<Direction>Down</Direction>'),
      property('WhammyBar', '<Enable />'),
      property('WhammyBarOriginValue', '<Float>0</Float>'),
      property('WhammyBarDestinationValue', '<Float>-100</Float>'),
      '</Properties>',
      '<XProperties><XProperty id="687935489"><Int>120</Int></XProperty></XProperties>',
    ].join('');
    const { score } = read(oneBar([beat('0', '0', '0', extra)], [note('0', 2, 5)], QUARTERS));
    expect(beatsOf(score)[0]).toMatchObject({
      text: 'let it ring',
      effects: {
        volumeSwell: true,
        tremoloPicking: 16,
        arpeggio: { direction: 'up', duration: 32 },
        pickStroke: 'down',
        whammy: {
          kind: 'dive',
          points: [
            { position: 0, value: 0 },
            { position: 60, value: -4 },
          ],
        },
      },
    });
  });

  it('reads the stroke length onto a brush and drops one that is not a note value', () => {
    const brush = (ticks: number): string =>
      `<Properties>${property('Brush', '<Direction>Up</Direction>')}</Properties><XProperties><XProperty id="687935489"><Int>${String(ticks)}</Int></XProperty></XProperties>`;
    const { score, warnings } = read(
      oneBar(
        [beat('0', '0', '0', brush(480)), beat('1', '0', '0', brush(500))],
        [note('0', 2, 5)],
        QUARTERS,
      ),
    );
    expect(beatsOf(score).map((b) => b.effects.brush)).toEqual([
      { direction: 'up', duration: 8 },
      { direction: 'up' },
    ]);
    expect(warnings.map((w) => w.message)).toContain(
      'A stroke length of 500 ticks is not a note value; dropped',
    );
  });

  it('reads a chord diagram from the staff collection', () => {
    const diagram = `<Items><Item id="0" name="Am"><Diagram stringCount="6" fretCount="5" baseFret="0">
      <Fret string="1" fret="0" /><Fret string="2" fret="2" /><Fret string="3" fret="2" />
      <Fret string="4" fret="1" /><Fret string="5" fret="0" />
      <Fingering><Position finger="Middle" fret="2" string="2" /><Position finger="Ring" fret="2" string="3" />
      <Position finger="Index" fret="1" string="4" /></Fingering>
      <Property name="ShowName" type="bool" value="true" /></Diagram></Item></Items>`;
    const { score } = read(
      oneBar([beat('0', '0', '0', '<Chord>0</Chord>')], [note('0', 1, 0)], QUARTERS, {
        tracks: [guitarTrack('0', { staffProperties: property('DiagramCollection', diagram) })],
      }),
    );
    expect(beatsOf(score)[0]?.chord).toEqual({
      name: 'Am',
      diagram: {
        baseFret: 1,
        frets: [0, 1, 2, 2, 0, null],
        fingering: [null, 'index', 'ring', 'middle', null, null],
      },
    });
  });
});

describe('master bars', () => {
  it('reads time, key, sections, triplet feel, double bars and directions', () => {
    const extra = [
      '<Section><Letter><![CDATA[A]]></Letter><Text><![CDATA[Verse]]></Text></Section>',
      '<TripletFeel>Triplet8th</TripletFeel>',
      '<DoubleBar />',
      '<Directions><Target>Segno</Target><Jump>DaSegnoAlCoda</Jump><Jump>DaCoda</Jump></Directions>',
    ].join('');
    const { score } = read(
      gpif({
        masterBars: [
          masterBar('0', extra, '3/4')
            .replace('<AccidentalCount>0', '<AccidentalCount>-3')
            .replace('Major', 'Minor'),
        ],
        bars: [bar('0', '-1 -1 -1 -1')],
        voices: [],
        beats: [],
        rhythms: [],
      }),
    );
    expect(score.masterBars[0]).toMatchObject({
      timeSignature: { numerator: 3, denominator: 4 },
      keySignature: { fifths: -3, minor: true },
      section: { name: 'Verse', letter: 'A' },
      tripletFeel: 'eighth',
      doubleBar: true,
      targets: ['segno'],
      jumps: [{ kind: 'dsAlCoda' }, { kind: 'toCoda' }],
    });
  });

  it('marks every bar of a volta bracket through its repeat end', () => {
    const bars = [
      '<Repeat start="true" end="false" count="0" />',
      '<AlternateEndings>1</AlternateEndings>',
      '',
      '<Repeat start="false" end="true" count="2" />',
      '<AlternateEndings>2</AlternateEndings>',
      '',
    ];
    const { score, warnings } = read(
      gpif({
        masterBars: bars.map((extra, index) => masterBar(String(index), extra)),
        bars: bars.map((_, index) => bar(String(index), '-1 -1 -1 -1')),
        voices: [],
        beats: [],
        rhythms: [],
      }),
    );
    expect(score.masterBars.map((m) => m.alternateEndings)).toEqual([[], [1], [1], [1], [2], []]);
    expect(score.masterBars[3]?.repeat).toEqual({ start: false, endCount: 2 });
    expect(codes({ score, warnings })).not.toContain('alternate-ending-outside-repeat');
  });

  it('reads tempo units and labels and defaults a missing first tempo', () => {
    const withUnit = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, {
        automations: [tempo(0, 0, '80 3')],
      }),
    );
    expect(withUnit.score.masterBars[0]?.tempo).toEqual({ bpm: 120, unit: 'dottedQuarter' });

    const without = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, { automations: [] }),
    );
    expect(without.score.masterBars[0]?.tempo).toEqual({ bpm: 120 });
    expect(codes(without)).toContain('default-tempo');
  });

  it('turns a linear tempo automation into a ramp from the previous one', () => {
    const { score } = read(
      gpif({
        automations: [tempo(0, 0, '120 2'), tempo(1, 0, '60 2', true)],
        masterBars: [masterBar('0'), masterBar('1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '0 -1 -1 -1')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(score.masterBars.map((m) => m.tempo?.bpm)).toEqual([120, 60]);
    expect(beatsOf(score, 0)[0]?.mix?.tempo).toEqual({ bpm: 60, duration: 4 });
  });

  it('reads anacrusis, clef changes and the first clef onto the track', () => {
    const { score } = read(
      gpif({
        masterBars: [masterBar('0'), masterBar('1'), masterBar('2')],
        bars: [
          bar('0', '-1 -1 -1 -1'),
          bar('1', '-1 -1 -1 -1').replace('G2', 'F4'),
          bar('2', '-1 -1 -1 -1').replace('G2', 'F4'),
        ],
        voices: [],
        beats: [],
        rhythms: [],
      }).replace('<Tracks>0</Tracks>', '<Tracks>0</Tracks><Anacrusis />'),
    );
    const track = score.tracks[0];
    expect(score.masterBars[0]?.anacrusis).toBe(true);
    expect(track?.display.clef).toBe('treble');
    expect(track?.bars.map((b) => b.clef)).toEqual([undefined, 'bass', undefined]);
  });
});

describe('tracks', () => {
  it('reads name, colour, capo, transposition and channel', () => {
    const { score, warnings } = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, {
        tracks: [
          guitarTrack('0', {
            staffProperties: property('CapoFret', '<Fret>2</Fret>'),
            extra:
              '<RSE><ChannelStrip><Parameters>0 0 0 0 0 0 0 0 0 0 0 0 0.5</Parameters></ChannelStrip></RSE>',
          })
            .replace('<Octave>-1</Octave>', '<Octave>-2</Octave>')
            .replace('<Chromatic>0</Chromatic>', '<Chromatic>3</Chromatic>')
            .replace('<PlaybackState>Default', '<PlaybackState>Solo'),
        ],
      }),
    );
    expect(score.tracks[0]).toMatchObject({
      name: 'Guitar 0',
      shortName: 'gtr.',
      color: '#ff0080',
      capo: 2,
      program: 25,
      display: { octaveShift: 2, clef: 'treble' },
      channel: { pan: 0, volume: 64, solo: true, mute: false },
    });
    expect(warnings.map((w) => w.message)).toContain(
      'A chromatic transposition: not modelled, dropped',
    );
  });

  it('decides the track kind from the program and the part configuration', () => {
    const piano = guitarTrack('0', { program: 0 });
    const xml = oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, { tracks: [piano] });
    expect(read(xml).score.tracks[0]?.kind).toBe('pitched');
    const tab = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);
    expect(read(xml, tab).score.tracks[0]).toMatchObject({
      kind: 'fretted',
      display: { notation: 'both' },
    });
    const standard = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
    const pitched = read(xml, standard).score.tracks[0];
    expect(pitched).toMatchObject({ kind: 'pitched', display: { notation: 'standard' } });
    // No `Midi` property here, so the pitch comes from the tuning: D3 (50) + 5.
    expect(pitched?.bars[0]?.voices[0].beats[0]?.notes[0]).toMatchObject({ string: 0, fret: 55 });
  });

  it('keeps a GP6 drum note without an articulation and reports one outside GM', () => {
    const gp6Drums = guitarTrack('0', {
      extra: '<GeneralMidi table="Percussion"><Program>0</Program></GeneralMidi>',
    });
    const { score, warnings } = read(
      oneBar(
        [beat('0', '0', '0 1')],
        [
          note('0', 0, 0, '', property('Midi', '<Number>38</Number>')),
          note('1', 0, 0, '', property('Midi', '<Number>91</Number>')),
        ],
        QUARTERS,
        { tracks: [gp6Drums] },
      ),
    );
    expect(score.tracks[0]?.kind).toBe('drums');
    expect(beatsOf(score)[0]?.notes.map((n) => n.fret)).toEqual([38, 91]);
    expect(warnings.map((w) => w.message)).toContain(
      'Drum note 91 has no articulation and is outside GM percussion (27 to 87); kept as is',
    );
  });

  it('merges a second staff onto free voices', () => {
    const twoStaves = guitarTrack('0').replace(
      '</Staves>',
      '<Staff><Properties /></Staff></Staves>',
    );
    const { score, warnings } = read(
      gpif({
        tracks: [twoStaves],
        masterBars: [masterBar('0 1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
        voices: [voice('0', '0'), voice('1', '1')],
        beats: [beat('0', '0', '0'), beat('1', '0', '1')],
        notes: [note('0', 2, 5), note('1', 0, 3)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(score.tracks[0]?.bars[0]?.voices.map((v) => v.beats.length)).toEqual([1, 1, 0, 0]);
    expect(codes({ score, warnings })).toContain('multiple-staves');
  });

  it('gives a second staff the same voice slot in every bar', () => {
    const twoStaves = guitarTrack('0').replace(
      '</Staves>',
      '<Staff><Properties /></Staff></Staves>',
    );
    const { score, warnings } = read(
      gpif({
        tracks: [twoStaves],
        masterBars: [masterBar('0 1'), masterBar('2 3')],
        // Staff 1 uses voice 2 only in the second bar; staff 2's voice still takes slot 3 in both.
        bars: [
          bar('0', '0 -1 -1 -1'),
          bar('1', '1 -1 -1 -1'),
          bar('2', '0 2 -1 -1'),
          bar('3', '3 -1 -1 -1'),
        ],
        voices: [voice('0', '0'), voice('1', '1'), voice('2', '0'), voice('3', '2')],
        beats: [beat('0', '0', '0'), beat('1', '0', '1'), beat('2', '0', '2')],
        notes: [
          note('0', 2, 5),
          note('1', 0, 3),
          note('2', 0, 3, '<Tie origin="false" destination="true" />'),
        ],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    const slots = score.tracks[0]?.bars.map((b) => b.voices.map((v) => v.beats.length));
    expect(slots).toEqual([
      [1, 0, 1, 0],
      [1, 1, 1, 0],
    ]);
    // The tie in bar 2 continues staff 2's note in bar 1, which only holds in a stable slot.
    expect(codes({ score, warnings })).not.toContain('tie-target');
  });

  it('drops a second-staff voice once, counting its bars, when staff 1 uses every slot', () => {
    const twoStaves = guitarTrack('0').replace(
      '</Staves>',
      '<Staff><Properties /></Staff></Staves>',
    );
    const { score, warnings } = read(
      gpif({
        tracks: [twoStaves],
        masterBars: [masterBar('0 1'), masterBar('2 1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '0 -1 -1 -1'), bar('2', '0 0 0 0')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(score.tracks[0]?.bars.map((b) => b.voices.map((v) => v.beats.length))).toEqual([
      [1, 0, 0, 0],
      [1, 1, 1, 1],
    ]);
    expect(warnings.filter((w) => w.code === 'voice-dropped')).toEqual([
      expect.objectContaining({ count: 2, path: 'Bars/Bar[1]' }),
    ]);
  });

  it('finds a hammer-on destination within three bars, and on the next beat off fretted tracks', () => {
    const origin = property('HopoOrigin', '<Enable />');
    const fretted = read(
      gpif({
        masterBars: ['0', '1', '2', '3', '4'].map((id) => masterBar(id)),
        bars: ['0', '1', '2', '3', '4'].map((id) => bar(id, `${id} -1 -1 -1`)),
        voices: [voice('0', '0'), voice('1', ''), voice('2', ''), voice('3', '1'), voice('4', '2')],
        beats: [beat('0', '0', '0 1'), beat('1', '0', '2'), beat('2', '0', '3')],
        notes: [
          note('0', 2, 5, '', origin),
          note('1', 4, 5, '', origin),
          note('2', 2, 7),
          note('3', 4, 7),
        ],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(beatsOf(fretted.score, 3)[0]?.notes[0]?.hammerPull).toBe(true);
    expect(beatsOf(fretted.score, 4)[0]?.notes[0]?.hammerPull).toBe(false);
    expect(fretted.warnings.filter((w) => w.code === 'hammer-pull-without-destination')).toEqual([
      expect.objectContaining({ count: 1, path: 'Notes/Note[1]' }),
    ]);

    const piano = guitarTrack('0', { program: 0 });
    const pitched = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0', '1')],
        [
          note('0', 2, 5, '', origin + property('Midi', '<Number>60</Number>')),
          note('1', 3, 5, '', property('Midi', '<Number>64</Number>')),
        ],
        QUARTERS,
        { tracks: [piano] },
      ),
    );
    expect(beatsOf(pitched.score).map((b) => b.notes[0]?.hammerPull)).toEqual([false, true]);
  });

  it('dispatches the raw lyric block when no beat has lyrics', () => {
    const lyrics =
      '<Lyrics><Line><Text><![CDATA[Hel-lo [aside] world+wide]]></Text><Offset>0</Offset></Line></Lyrics>';
    const { score } = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '0'), beat('2', '0', '0'), beat('3', '0', '0')],
        [note('0', 2, 5)],
        QUARTERS,
        { tracks: [guitarTrack('0', { extra: lyrics })] },
      ),
    );
    expect(score.tracks[0]?.lyrics).toEqual([{ startBar: 0, text: 'Hel-lo [aside] world+wide' }]);
    expect(beatsOf(score).map((b) => b.lyrics)).toEqual([
      ['Hel-'],
      undefined,
      ['lo'],
      ['world wide'],
    ]);
  });

  it('applies a mid-song sound change as a program change', () => {
    const sounds = `<Automations><Automation><Type>Sound</Type><Linear>false</Linear><Bar>1</Bar><Position>0</Position>
      <Visible>true</Visible><Value><![CDATA[Keys/Organ;Organ;Factory]]></Value></Automation></Automations>`;
    const track = guitarTrack('0', { extra: sounds }).replace(
      '</Sounds>',
      '<Sound><Name>Organ</Name><Path>Keys/Organ</Path><Role>Factory</Role><MIDI><Program>19</Program></MIDI></Sound></Sounds>',
    );
    const { score } = read(
      gpif({
        tracks: [track],
        masterBars: [masterBar('0'), masterBar('1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '0 -1 -1 -1')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(score.tracks[0]?.program).toBe(25);
    expect(beatsOf(score, 1)[0]?.mix).toEqual({ program: 19 });
  });

  it('expands a simile mark into a copy of the previous bar', () => {
    const { score, warnings } = read(
      gpif({
        masterBars: [masterBar('0'), masterBar('1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '-1 -1 -1 -1', '<SimileMark>Simple</SimileMark>')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    const [first, second] = [beatsOf(score, 0)[0], beatsOf(score, 1)[0]];
    expect(second?.notes[0]?.fret).toBe(5);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.notes[0]?.id).not.toBe(first?.notes[0]?.id);
    expect(codes({ score, warnings })).toContain('simile-expanded');
  });
});

describe('diagnostics', () => {
  it('warns about unknown elements and values with their path', () => {
    const { warnings } = read(
      oneBar(
        [beat('0', '0', '0', '<Sparkle>yes</Sparkle><Fadding>Sideways</Fadding>')],
        [note('0', 2, 5)],
        QUARTERS,
      ),
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'unknown-element', path: 'Beats/Beat[0]/Sparkle' }),
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'unknown-value', path: 'Beats/Beat[0]/Fadding' }),
    );
  });

  it('folds repeats of one loss into a counted warning', () => {
    const timer = '<Timer>1</Timer>';
    const { warnings } = read(
      oneBar([beat('0', '0', '0', timer), beat('1', '0', '0', timer)], [note('0', 2, 5)], QUARTERS),
    );
    expect(
      warnings.filter((w) => w.code === 'not-modelled' && w.message.startsWith('A timer')),
    ).toEqual([expect.objectContaining({ count: 2, path: 'Beats/Beat[0]/Timer' })]);
  });

  it('warns about dangling references', () => {
    const { warnings } = read(
      oneBar([beat('0', '0', '0 9'), beat('1', '7')], [note('0', 2, 5)], QUARTERS),
    );
    expect(warnings.filter((w) => w.code === 'missing-reference').map((w) => w.message)).toEqual([
      'Note 9 is referenced but not defined; skipped',
      'Rhythm 7 is not defined; read as a quarter',
    ]);
  });

  it('reports invariant violations as warnings', () => {
    const { warnings } = read(oneBar([beat('0', '0', '0')], [note('0', 2, 30)], QUARTERS));
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'fret-range',
        path: 'score.tracks[0].bars[0].voices[0].beats[0].notes[0].fret',
      }),
    );
  });

  it('fails without tracks or bars, on a foreign root and on bad bytes', () => {
    expect(() =>
      readGpif(
        gpif({
          tracks: [],
          masterBars: [masterBar('')],
          bars: [],
          voices: [],
          beats: [],
          rhythms: [],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'empty-score' }));
    expect(() =>
      readGpif(gpif({ masterBars: [], bars: [], voices: [], beats: [], rhythms: [] })),
    ).toThrow(expect.objectContaining({ code: 'empty-score' }));
    expect(() => readGpif('<Score />')).toThrow(GpifError);
    expect(() => readGpif(new Uint8Array([0x3c, 0xff, 0xfe]))).toThrow(
      expect.objectContaining({ code: 'invalid-utf8' }),
    );
  });
});
