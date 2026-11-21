import { ScoreSchema, type Beat, type Note, type Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { GpifError } from './errors';
import { readGpif, type GpifReadResult } from './read-gpif';
import { writeGpif } from './write-gpif';
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
  secondStaff,
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

const codes = (result: Pick<GpifReadResult, 'warnings'>): string[] =>
  result.warnings.map((warning) => warning.code);

const QUARTERS = [rhythm('0', 'Quarter')];

const brushOf = (ticks: number): string =>
  `<Properties>${property('Brush', '<Direction>Up</Direction>')}</Properties><XProperties><XProperty id="687935489"><Int>${String(ticks)}</Int></XProperty></XProperties>`;

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

  it('keeps the origin first when its offset is after the middle offsets', () => {
    const properties = [
      property('Bended', '<Enable />'),
      property('BendOriginValue', '<Float>75</Float>'),
      property('BendOriginOffset', '<Float>76</Float>'),
      property('BendMiddleValue', '<Float>37</Float>'),
      property('BendMiddleOffset1', '<Float>12</Float>'),
      property('BendMiddleOffset2', '<Float>12</Float>'),
      property('BendDestinationValue', '<Float>0</Float>'),
      property('BendDestinationOffset', '<Float>99</Float>'),
    ].join('');
    const { score } = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 5, '', properties)], QUARTERS),
    );
    const points = firstNote(score)?.bend?.points ?? [];
    expect(points.map((point) => point.value)).toEqual([3, 1.48, 1.48, 0]);
    expect(points.map((point) => point.position)).toEqual([45.6, 45.6, 45.6, 59.4]);
  });

  describe('bend point order', () => {
    const bendPositions = (entries: Record<string, number>): number[] => {
      const properties = [
        property('Bended', '<Enable />'),
        ...Object.entries(entries).map(([name, value]) =>
          property(`Bend${name}`, `<Float>${String(value)}</Float>`),
        ),
      ].join('');
      const { score } = read(
        oneBar([beat('0', '0', '0')], [note('0', 2, 5, '', properties)], QUARTERS),
      );
      return (firstNote(score)?.bend?.points ?? []).map((point) => point.position);
    };
    const ascending = (positions: number[]): boolean =>
      positions.every((at, index) => index === 0 || at >= (positions[index - 1] ?? 0));

    it('clamps the halfway point of a bend whose origin is after the middle', () => {
      const positions = bendPositions({
        OriginValue: 75,
        OriginOffset: 76,
        MiddleValue: 37,
        DestinationValue: 0,
        DestinationOffset: 99,
      });
      expect(positions).toHaveLength(3);
      expect(ascending(positions)).toBe(true);
      expect(positions[1]).toBeCloseTo(45.6);
    });

    it('holds a destination before the origin at the origin', () => {
      const positions = bendPositions({
        OriginValue: 0,
        OriginOffset: 80,
        DestinationValue: 50,
        DestinationOffset: 20,
      });
      expect(positions).toHaveLength(2);
      expect(positions[1]).toBeCloseTo(48);
    });

    it('clamps a middle offset after the destination', () => {
      const positions = bendPositions({
        OriginValue: 0,
        OriginOffset: 0,
        MiddleValue: 100,
        MiddleOffset1: 90,
        DestinationValue: 0,
        DestinationOffset: 50,
      });
      expect(ascending(positions)).toBe(true);
      expect(positions[1]).toBeCloseTo(30);
    });

    it('keeps a whammy origin first and its points ascending', () => {
      const extra = [
        '<Properties>',
        property('WhammyBar', '<Enable />'),
        property('WhammyBarOriginValue', '<Float>0</Float>'),
        property('WhammyBarOriginOffset', '<Float>80</Float>'),
        property('WhammyBarMiddleValue', '<Float>-50</Float>'),
        property('WhammyBarMiddleOffset1', '<Float>10</Float>'),
        property('WhammyBarDestinationValue', '<Float>0</Float>'),
        property('WhammyBarDestinationOffset', '<Float>100</Float>'),
        '</Properties>',
      ].join('');
      const { score } = read(oneBar([beat('0', '0', '0', extra)], [note('0', 2, 5)], QUARTERS));
      const points = beatsOf(score)[0]?.effects.whammy?.points ?? [];
      expect(points.map((point) => point.value)).toEqual([0, -2, 0]);
      expect(ascending(points.map((point) => point.position))).toBe(true);
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

  describe('hammer-ons through grace notes', () => {
    const origin = property('HopoOrigin', '<Enable />');
    const grace = '<GraceNotes>BeforeBeat</GraceNotes>';
    const RHYTHMS = [rhythm('0', 'Whole'), rhythm('1', '32nd')];
    const flags = (score: Score): (boolean | undefined)[] =>
      beatsOf(score).flatMap((b) => [
        ...(b.grace ?? []).flatMap((g) => g.notes.map((n) => n.hammerPull)),
        ...b.notes.map((n) => n.hammerPull),
      ]);
    const lost = (result: GpifReadResult) =>
      result.warnings.filter((w) => w.code === 'hammer-pull-without-destination');
    /** Reads, then writes and reads again: both must agree, and the re-read has nothing left to drop. */
    const roundTrip = (xml: string) => {
      const first = read(xml);
      const again = read(writeGpif(first.score).xml);
      expect(flags(again.score)).toEqual(flags(first.score));
      expect(lost(again)).toEqual([]);
      return first;
    };

    it('links a grace note to the beat note on its string', () => {
      const result = roundTrip(
        oneBar(
          [beat('0', '1', '0', grace), beat('1', '0', '1')],
          [note('0', 2, 5, '', origin), note('1', 2, 7)],
          RHYTHMS,
        ),
      );
      expect(flags(result.score)).toEqual([false, true]);
      expect(lost(result)).toEqual([]);
    });

    it('links a grace note to the next grace on its string, not the main note', () => {
      const result = roundTrip(
        oneBar(
          [beat('0', '1', '0', grace), beat('1', '1', '1', grace), beat('2', '0', '2')],
          [note('0', 2, 5, '', origin), note('1', 2, 7), note('2', 2, 9)],
          RHYTHMS,
        ),
      );
      expect(flags(result.score)).toEqual([false, true, false]);
      expect(lost(result)).toEqual([]);
    });

    it('warns and drops a grace note with no destination', () => {
      const result = roundTrip(
        oneBar(
          [beat('0', '1', '0', grace), beat('1', '0', '1')],
          [note('0', 2, 5, '', origin), note('1', 3, 7)],
          RHYTHMS,
        ),
      );
      expect(flags(result.score)).toEqual([false, false]);
      expect(lost(result)).toHaveLength(1);
    });

    it('searches later beats when the beat has no note on the grace string', () => {
      const result = roundTrip(
        oneBar(
          [beat('0', '1', '0', grace), beat('1', '0', '1'), beat('2', '0', '2')],
          [note('0', 2, 5, '', origin), note('1', 3, 7), note('2', 2, 9)],
          RHYTHMS,
        ),
      );
      expect(flags(result.score)).toEqual([false, false, true]);
      expect(lost(result)).toEqual([]);
    });

    it('links a main note to the next beat grace on its string', () => {
      const result = roundTrip(
        oneBar(
          [beat('0', '0', '0'), beat('1', '1', '1', grace), beat('2', '0', '2')],
          [note('0', 2, 5, '', origin), note('1', 2, 7), note('2', 2, 9)],
          RHYTHMS,
        ),
      );
      expect(flags(result.score)).toEqual([false, true, false]);
      expect(lost(result)).toEqual([]);
    });
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
    expect(codes({ warnings })).toContain('long-note-tied');
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

  it.each([
    [960, 4],
    [480, 8],
    [74, 64],
    [56, 64],
    [500, 8],
    [84, 64],
    [85, 32],
    [30, 128],
    [10, 128],
    [2000, 4],
  ])('reads a stroke length of %i ticks as a 1/%i brush', (ticks, duration) => {
    const { score, warnings } = read(
      oneBar([beat('0', '0', '0', brushOf(ticks))], [note('0', 2, 5)], QUARTERS),
    );
    expect(beatsOf(score).map((b) => b.effects.brush)).toEqual([{ direction: 'up', duration }]);
    expect(warnings).toEqual([]);
  });

  it.each([0, -5])('drops a stroke length of %i ticks with one warning', (ticks) => {
    const { score, warnings } = read(
      oneBar([beat('0', '0', '0', brushOf(ticks))], [note('0', 2, 5)], QUARTERS),
    );
    expect(beatsOf(score).map((b) => b.effects.brush)).toEqual([{ direction: 'up' }]);
    expect(warnings.map((w) => w.message)).toEqual([
      `A stroke length of ${String(ticks)} ticks is not positive; dropped`,
    ]);
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
    expect(codes({ warnings })).not.toContain('alternate-ending-outside-repeat');
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

  describe('a fretted track on a non-fretted program with no Transpose', () => {
    const noTranspose = (track: string): string =>
      track.replace(/<Transpose>.*<\/Transpose>\n/, '');
    const tab = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);
    const xml = (track: string): string =>
      oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, { tracks: [track] });

    it('is written at sounding pitch, as GP6 PartSounding gives', () => {
      const piano = read(xml(noTranspose(guitarTrack('0', { program: 0 }))), tab);
      expect(piano.score.tracks[0]).toMatchObject({
        kind: 'fretted',
        display: { octaveShift: 0 },
      });
    });

    it('leaves a guitar at the fretted default of 1', () => {
      const guitar = read(xml(noTranspose(guitarTrack('0', { program: 25 }))), tab);
      expect(guitar.score.tracks[0]).toMatchObject({
        kind: 'fretted',
        display: { octaveShift: 1 },
      });
    });
  });

  it('reads a vocal track with string-less pitched notes as pitched, keeping them', () => {
    const track = guitarTrack('0', { program: 53 });
    const stringless = `<Note id="0"><Properties>${property('Midi', '<Number>60</Number>')}</Properties></Note>`;
    const xml = oneBar([beat('0', '0', '0')], [stringless], QUARTERS, { tracks: [track] });
    const { score, warnings } = read(xml);
    expect(score.tracks[0]?.kind).toBe('pitched');
    expect(codes({ warnings })).toContain('off-fretboard');
  });

  describe('a vocal track with no notation instruction', () => {
    const noTranspose = (track: string): string =>
      track.replace(/<Transpose>.*<\/Transpose>\n/, '');
    const voice53 = noTranspose(guitarTrack('0', { program: 53 }));
    const xml = (track: string): string =>
      oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, { tracks: [track] });
    const standard = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
    const both = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);

    it('stays fretted, unshifted and implicit with no part configuration', () => {
      const { score, implicitNotation } = read(xml(voice53));
      expect(score.tracks[0]).toMatchObject({
        kind: 'fretted',
        display: { notation: 'tab', octaveShift: 0 },
      });
      expect(implicitNotation).toEqual(score.tracks.map((track) => track.id));
    });

    it('is recognised by its name too', () => {
      const named = noTranspose(guitarTrack('0', { program: 0 })).replace(
        'Guitar 0',
        'Lead Vocals',
      );
      const { score, implicitNotation } = read(xml(named));
      expect(score.tracks[0]).toMatchObject({ kind: 'fretted', display: { octaveShift: 0 } });
      expect(implicitNotation).toHaveLength(1);
    });

    it('follows a part configuration that says standard, and is then explicit', () => {
      const { score, implicitNotation } = read(xml(voice53), standard);
      expect(score.tracks[0]).toMatchObject({ kind: 'pitched', display: { notation: 'standard' } });
      expect(implicitNotation).toEqual([]);
    });

    it('follows a part configuration that says both, and is then explicit', () => {
      const { score, implicitNotation } = read(xml(voice53), both);
      expect(score.tracks[0]).toMatchObject({ kind: 'fretted', display: { notation: 'both' } });
      expect(implicitNotation).toEqual([]);
    });

    it('makes every track implicit when the part configuration has the wrong count', () => {
      const twoEntries = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 2, 3, 3]);
      const { score, implicitNotation, warnings } = read(xml(voice53), twoEntries);
      expect(codes({ warnings })).toContain('invalid-value');
      expect(implicitNotation).toEqual(score.tracks.map((track) => track.id));
    });

    it('stays pitched when it has no tuning', () => {
      const bare = voice53.replace(/<Property name="Tuning">[\s\S]*?<\/Property>/, '');
      const { score } = read(xml(bare));
      expect(score.tracks[0]?.kind).toBe('pitched');
    });

    it('lists a keyboard track with no part configuration as implicit but pitched', () => {
      const { score, implicitNotation } = read(xml(guitarTrack('0', { program: 0 })));
      expect(score.tracks[0]?.kind).toBe('pitched');
      expect(implicitNotation).toHaveLength(1);
    });
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
    expect(codes({ warnings })).toContain('multiple-staves');
  });

  describe('a second staff with its own tuning', () => {
    const LEFT_HAND = '28 33 38 43';
    const midi = (value: number): string => property('Midi', `<Number>${String(value)}</Number>`);
    const standard = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
    const tab = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);

    function twoStaffs(
      track: string,
      staffTwoNote: string,
      { bars = 1, partConfiguration }: { bars?: number; partConfiguration?: Uint8Array } = {},
    ): GpifReadResult {
      const ids = Array.from({ length: bars }, (_, index) => String(index));
      return read(
        gpif({
          tracks: [track],
          masterBars: ids.map((id) =>
            masterBar(`${String(Number(id) * 2)} ${String(Number(id) * 2 + 1)}`),
          ),
          bars: ids.flatMap((id) => [
            bar(String(Number(id) * 2), `${id} -1 -1 -1`),
            bar(String(Number(id) * 2 + 1), `${String(Number(id) + bars)} -1 -1 -1`),
          ]),
          voices: [
            ...ids.map((id) => voice(id, id)),
            ...ids.map((id) => voice(String(Number(id) + bars), String(Number(id) + bars))),
          ],
          beats: [
            ...ids.map((id) => beat(id, '0', '0')),
            ...ids.map((id) => beat(String(Number(id) + bars), '0', '1')),
          ],
          notes: [note('0', 2, 5), staffTwoNote],
          rhythms: [rhythm('0', 'Whole')],
        }),
        partConfiguration,
      );
    }
    const withStaff = (options = {}, pitches = LEFT_HAND, capo = 0): string =>
      guitarTrack('0', options).replace('</Staves>', `${secondStaff(pitches, capo)}</Staves>`);
    const noteIn = (result: GpifReadResult, slot: number): Note | undefined =>
      beatsOf(result.score, 0, slot)[0]?.notes[0];

    it('reads the left hand at its own pitch, on a keyboard track', () => {
      const result = twoStaffs(withStaff({ program: 0 }), note('1', 0, 5, '', midi(33)));
      expect(result.score.tracks[0]?.kind).toBe('pitched');
      expect(noteIn(result, 0)?.fret).toBe(55);
      expect(noteIn(result, 1)?.fret).toBe(33);
      const message = result.warnings.find((w) => w.code === 'multiple-staves')?.message;
      expect(message).toContain('read as a keyboard part (standard notation)');
      expect(message).toContain('staff 2');
    });

    it('reads a guitar-program track as pitched and puts the note at 33, not 45', () => {
      const result = twoStaffs(withStaff(), note('1', 0, 5));
      expect(result.score.tracks[0]?.kind).toBe('pitched');
      expect(noteIn(result, 1)?.fret).toBe(33);
    });

    it('adds the staff capo when the pitch comes from its tuning', () => {
      const result = twoStaffs(withStaff({}, LEFT_HAND, 2), note('1', 0, 5));
      expect(noteIn(result, 1)?.fret).toBe(35);
    });

    it('reads a staff with the same tuning and only a different capo as pitched', () => {
      const result = twoStaffs(withStaff({}, '40 45 50 55 59 64', 2), note('1', 0, 5));
      expect(result.score.tracks[0]?.kind).toBe('pitched');
      expect(noteIn(result, 1)?.fret).toBe(47);
      expect(result.warnings.find((w) => w.code === 'multiple-staves')?.message).toContain(
        'own tuning or capo',
      );
    });

    it('adds the capo to the tuning of a single-staff pitched track', () => {
      const piano = guitarTrack('0', { program: 0 }).replace('<Fret>0</Fret>', '<Fret>3</Fret>');
      const result = read(
        oneBar([beat('0', '0', '0')], [note('0', 2, 5)], QUARTERS, { tracks: [piano] }),
      );
      expect(result.score.tracks[0]?.kind).toBe('pitched');
      expect(firstNote(result.score)?.fret).toBe(58);
    });

    it('keeps a note below the first staff lowest string', () => {
      const result = twoStaffs(withStaff({ program: 0 }), note('1', 0, -2, '', midi(26)));
      expect(noteIn(result, 1)?.fret).toBe(26);
      expect(codes(result)).not.toContain('invalid-value');
    });

    it('stays pitched when the part configuration shows tablature', () => {
      const result = twoStaffs(withStaff({ program: 0 }), note('1', 0, 5, '', midi(33)), {
        partConfiguration: tab,
      });
      expect(result.score.tracks[0]).toMatchObject({
        kind: 'pitched',
        display: { notation: 'standard' },
      });
      const alone = twoStaffs(withStaff(), note('1', 0, 5, '', midi(33)), {
        partConfiguration: standard,
      });
      expect(alone.score.tracks[0]?.kind).toBe('pitched');
    });

    it('keeps the track fretted when the second staff has no tuning or the same one', () => {
      const bare = guitarTrack('0').replace('</Staves>', '<Staff><Properties /></Staff></Staves>');
      const same = withStaff({}, '40 45 50 55 59 64');
      for (const track of [bare, same]) {
        const result = twoStaffs(track, note('1', 0, 3));
        expect(result.score.tracks[0]?.kind).toBe('fretted');
        expect(noteIn(result, 1)).toMatchObject({ string: 6, fret: 3 });
        expect(result.warnings.find((w) => w.code === 'multiple-staves')?.message).not.toContain(
          'keyboard',
        );
      }
    });

    it('keeps a tie across bars in the second staff', () => {
      const result = read(
        gpif({
          tracks: [withStaff({ program: 0 })],
          masterBars: [masterBar('0 1'), masterBar('2 3')],
          bars: [
            bar('0', '0 -1 -1 -1'),
            bar('1', '1 -1 -1 -1'),
            bar('2', '0 -1 -1 -1'),
            bar('3', '2 -1 -1 -1'),
          ],
          voices: [voice('0', '0'), voice('1', '1'), voice('2', '2')],
          beats: [beat('0', '0', '0'), beat('1', '0', '1'), beat('2', '0', '2')],
          notes: [
            note('0', 2, 5),
            note('1', 0, 5, '', midi(33)),
            note('2', 0, 5, '<Tie origin="false" destination="true" />', midi(33)),
          ],
          rhythms: [rhythm('0', 'Whole')],
        }),
      );
      expect(result.score.tracks[0]?.kind).toBe('pitched');
      expect(codes(result)).not.toContain('tie-target');
    });
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
    expect(codes({ warnings })).not.toContain('tie-target');
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

  describe('a sound change in a bar with no beats', () => {
    const change = (bar: number, name: string): string =>
      `<Automation><Type>Sound</Type><Linear>false</Linear><Bar>${String(bar)}</Bar><Position>0</Position>
      <Visible>true</Visible><Value><![CDATA[Keys/${name};${name};Factory]]></Value></Automation>`;
    const sound = (name: string, program: number): string =>
      `<Sound><Name>${name}</Name><Path>Keys/${name}</Path><Role>Factory</Role><MIDI><Program>${String(program)}</Program></MIDI></Sound>`;
    const organ = (automations: string[]): string =>
      guitarTrack('0', { extra: `<Automations>${automations.join('')}</Automations>` }).replace(
        '</Sounds>',
        `${sound('Organ', 19)}${sound('Bass', 33)}</Sounds>`,
      );
    // Each filled bar gets a voice and a beat of its own, as Guitar Pro writes them.
    const readBars = (bars: string[], automations: string[]): ReturnType<typeof read> => {
      const filled = bars.flatMap((voices, index) => (voices === '0' ? [String(index)] : []));
      return read(
        gpif({
          tracks: [organ(automations)],
          masterBars: bars.map((_, index) => masterBar(String(index))),
          bars: bars.map((voices, index) =>
            bar(String(index), voices === '0' ? `${String(index)} -1 -1 -1` : '-1 -1 -1 -1'),
          ),
          voices: filled.map((id) => voice(id, id)),
          beats: filled.map((id) => beat(id, '0', '0')),
          notes: [note('0', 2, 5)],
          rhythms: [rhythm('0', 'Whole')],
        }),
      );
    };

    it("moves to the track's next beat and says so (#153)", () => {
      const result = readBars(['0', '-', '0'], [change(1, 'Organ')]);
      expect(beatsOf(result.score, 2)[0]?.mix).toEqual({ program: 19 });
      expect(codes(result)).toContain('automation-moved');
      expect(codes(result)).not.toContain('automation-dropped');
    });

    it("does not overwrite the target bar's own change, whatever the document order", () => {
      const result = readBars(['0', '-', '0'], [change(2, 'Bass'), change(1, 'Organ')]);
      expect(beatsOf(result.score, 2)[0]?.mix).toEqual({ program: 33 });
    });

    it('is dropped when no later bar has a beat', () => {
      const result = readBars(['0', '-'], [change(1, 'Organ')]);
      expect(codes(result)).toContain('automation-dropped');
      expect(codes(result)).not.toContain('automation-moved');
    });
  });

  describe('an over-full bar', () => {
    const sixBeats = [0, 1, 2, 3, 4, 5].map((index) => beat(String(index), '0', '0'));

    it("puts a tempo automation past 1 on its over-full bar's overflow beat", () => {
      const result = read(
        gpif({
          automations: [tempo(0, 0, '120 2'), tempo(0, 1, '90 2'), tempo(0, 1.25, '60 2')],
          masterBars: [masterBar('0')],
          bars: [bar('0', '0 -1 -1 -1')],
          voices: [voice('0', '0 1 2 3 4 5')],
          beats: sixBeats,
          notes: [note('0', 2, 5)],
          rhythms: QUARTERS,
        }),
      );
      expect(beatsOf(result.score)[4]?.mix?.tempo).toEqual({ bpm: 90 });
      expect(beatsOf(result.score)[5]?.mix?.tempo).toEqual({ bpm: 60 });
      expect(codes(result)).not.toContain('tempo-moved');
    });

    it('measures a linear automation across an over-full bar by its longest voice', () => {
      const { score } = read(
        gpif({
          automations: [tempo(0, 0, '120 2'), tempo(1, 0, '60 2', true)],
          masterBars: [masterBar('0'), masterBar('1')],
          bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
          voices: [voice('0', '0 1 2 3 4 5'), voice('1', '6')],
          beats: [...sixBeats, beat('6', '1', '0')],
          notes: [note('0', 2, 5)],
          rhythms: [...QUARTERS, rhythm('1', 'Whole')],
        }),
      );
      expect(beatsOf(score, 0)[0]?.mix?.tempo).toEqual({ bpm: 60, duration: 6 });
    });

    it.each([Infinity, NaN])(
      'caps a Position of %s at its bar and round-trips the score',
      (position) => {
        const { score } = read(
          gpif({
            automations: [tempo(0, 0, '120 2'), tempo(1, position, '60 2', true)],
            masterBars: [masterBar('0'), masterBar('1')],
            bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
            voices: [voice('0', '0 1 2 3 4 5'), voice('1', '6')],
            beats: [...sixBeats, beat('6', '1', '0')],
            notes: [note('0', 2, 5)],
            rhythms: [...QUARTERS, rhythm('1', 'Whole')],
          }),
        );
        expect(ScoreSchema.safeParse(score).success).toBe(true);
        const written = writeGpif(score).xml;
        expect(written).not.toMatch(/Infinity|NaN/);
        expect(ScoreSchema.safeParse(read(written).score).success).toBe(true);
      },
    );

    it('puts a sound change past 1 on the overflow beat', () => {
      const sounds = `<Automations><Automation><Type>Sound</Type><Linear>false</Linear><Bar>0</Bar><Position>1.25</Position>
        <Visible>true</Visible><Value><![CDATA[Keys/Organ;Organ;Factory]]></Value></Automation></Automations>`;
      const track = guitarTrack('0', { extra: sounds }).replace(
        '</Sounds>',
        '<Sound><Name>Organ</Name><Path>Keys/Organ</Path><Role>Factory</Role><MIDI><Program>19</Program></MIDI></Sound></Sounds>',
      );
      const { score } = read(
        gpif({
          tracks: [track],
          masterBars: [masterBar('0')],
          bars: [bar('0', '0 -1 -1 -1')],
          voices: [voice('0', '0 1 2 3 4 5')],
          beats: sixBeats,
          notes: [note('0', 2, 5)],
          rhythms: QUARTERS,
        }),
      );
      expect(beatsOf(score)[5]?.mix).toEqual({ program: 19 });
      expect(beatsOf(score)[4]?.mix).toBeUndefined();
    });
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
    expect(codes({ warnings })).toContain('simile-expanded');
  });
});

describe('notes off the fretboard', () => {
  const midi = (value: number): string => property('Midi', `<Number>${String(value)}</Number>`);
  const tab = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3]);
  const offFretboard = (result: GpifReadResult) =>
    result.warnings.filter((w) => w.code === 'off-fretboard');
  const midis = (result: GpifReadResult, beatIndex = 0): number[] =>
    (beatsOf(result.score)[beatIndex]?.notes ?? []).map((n) => n.fret);

  it('reads a note below the lowest string as pitched, keeping its MIDI pitch', () => {
    const result = read(
      oneBar(
        [beat('0', '0', '0 1')],
        [note('0', 0, -2, '', midi(38)), note('1', 3, 2, '', midi(52))],
        QUARTERS,
      ),
    );
    expect(result.score.tracks[0]).toMatchObject({ kind: 'pitched' });
    expect(midis(result)).toEqual([38, 52]);
    expect(codes(result)).not.toContain('invalid-value');
    expect(offFretboard(result)).toHaveLength(1);
    expect(offFretboard(result)[0]?.message).toContain('1 below fret 0');
    expect(offFretboard(result)[0]?.path).toBe('Tracks/Track[0]');
  });

  it('reads a fret past the neck as pitched', () => {
    const result = read(oneBar([beat('0', '0', '0')], [note('0', 2, 30, '', midi(94))], QUARTERS));
    expect(result.score.tracks[0]?.kind).toBe('pitched');
    expect(midis(result)).toEqual([94]);
    expect(codes(result)).not.toContain('fret-range');
  });

  it("measures the neck by the track's own fret count", () => {
    const track = guitarTrack('0', { fretCount: 27 });
    const fits = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 26)], QUARTERS, { tracks: [track] }),
    );
    expect(fits.score.tracks[0]?.kind).toBe('fretted');
    expect(offFretboard(fits)).toHaveLength(0);
    const past = read(
      oneBar([beat('0', '0', '0')], [note('0', 2, 28)], QUARTERS, { tracks: [track] }),
    );
    expect(past.score.tracks[0]?.kind).toBe('pitched');
    expect(offFretboard(past)[0]?.message).toContain('1 past fret 27');
  });

  it('reads two notes on one string of one beat as pitched, keeping both', () => {
    const result = read(
      oneBar(
        [beat('0', '0', '0 1')],
        [note('0', 2, 5, '', midi(55)), note('1', 2, 7, '', midi(57))],
        QUARTERS,
      ),
    );
    expect(result.score.tracks[0]?.kind).toBe('pitched');
    expect(midis(result)).toEqual([55, 57]);
    expect(codes(result)).not.toContain('duplicate-string');
    expect(offFretboard(result)[0]?.message).toContain('1 sharing a string in their beat');
  });

  it('keeps a track fretted when two voices use one string at the same time', () => {
    const result = read(
      gpif({
        masterBars: [masterBar('0')],
        bars: [bar('0', '0 1 -1 -1')],
        voices: [voice('0', '0'), voice('1', '1')],
        beats: [beat('0', '0', '0'), beat('1', '0', '1')],
        notes: [note('0', 2, 5), note('1', 2, 7)],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(result.score.tracks[0]?.kind).toBe('fretted');
    expect(offFretboard(result)).toHaveLength(0);
  });

  it('finds the fret of a note with only a MIDI pitch below its open string', () => {
    // Open string 2 is D3 (50); MIDI 40 is 10 frets below it.
    const bare = `<Note id="0"><Properties>${property('String', '<String>2</String>')}${midi(40)}</Properties></Note>`;
    const result = read(oneBar([beat('0', '0', '0')], [bare], QUARTERS));
    expect(result.score.tracks[0]?.kind).toBe('pitched');
    expect(midis(result)).toEqual([40]);
  });

  it('reads a note without MIDI at fret -2 on the lowest string as pitched, at its tuning pitch', () => {
    const result = read(oneBar([beat('0', '0', '0')], [note('0', 0, -2)], QUARTERS));
    expect(result.score.tracks[0]?.kind).toBe('pitched');
    expect(midis(result)).toEqual([38]);
  });

  it('overrides a part configuration that shows tablature', () => {
    const track = guitarTrack('0', { program: 60 });
    const result = read(
      oneBar([beat('0', '0', '0')], [note('0', 0, -2, '', midi(38))], QUARTERS, {
        tracks: [track],
      }),
      tab,
    );
    expect(result.score.tracks[0]).toMatchObject({
      kind: 'pitched',
      display: { notation: 'standard' },
    });
    expect(midis(result)).toEqual([38]);
  });

  it('flips a merged track whose staves agree when a note overflows only in the second', () => {
    const two = guitarTrack('0').replace(
      '</Staves>',
      `${secondStaff('40 45 50 55 59 64')}</Staves>`,
    );
    const result = read(
      gpif({
        tracks: [two],
        masterBars: [masterBar('0 1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
        voices: [voice('0', '0'), voice('1', '1')],
        beats: [beat('0', '0', '0'), beat('1', '0', '1')],
        notes: [note('0', 2, 5), note('1', 0, -2, '', midi(38))],
        rhythms: [rhythm('0', 'Whole')],
      }),
    );
    expect(result.score.tracks[0]?.kind).toBe('pitched');
    expect(result.warnings.find((w) => w.code === 'multiple-staves')?.message).not.toContain(
      'keyboard',
    );
    expect(offFretboard(result)).toHaveLength(1);
  });

  it('counts the notes of a grace beat', () => {
    const result = read(
      oneBar(
        [beat('0', '0', '0 1', '<GraceNotes>BeforeBeat</GraceNotes>'), beat('1', '1', '2')],
        [note('0', 2, 5), note('1', 2, 7), note('2', 3, 5)],
        [rhythm('0', 'Sixteenth'), rhythm('1', 'Whole')],
      ),
    );
    expect(result.score.tracks[0]?.kind).toBe('pitched');
  });

  it('ignores off-fretboard notes in grace beats that end a voice and are dropped', () => {
    const result = read(
      oneBar(
        [beat('0', '0', '0'), beat('1', '1', '1 2', '<GraceNotes>BeforeBeat</GraceNotes>')],
        [note('0', 2, 5), note('1', 2, 7), note('2', 2, 9)],
        [rhythm('0', 'Half'), rhythm('1', 'Sixteenth')],
      ),
    );
    expect(codes(result)).toContain('grace-without-beat');
    expect(result.score.tracks[0]?.kind).toBe('fretted');
  });

  it('leaves a clean guitar, a drum kit and a pitched track alone', () => {
    const clean = read(
      oneBar([beat('0', '0', '0 1')], [note('0', 2, 5), note('1', 3, 7)], QUARTERS),
    );
    expect(clean.score.tracks[0]?.kind).toBe('fretted');
    const drums = guitarTrack('0', {
      extra: '<GeneralMidi table="Percussion"><Program>0</Program></GeneralMidi>',
    });
    const kit = read(
      oneBar(
        [beat('0', '0', '0 1')],
        [note('0', 0, 0, '', midi(38)), note('1', 0, 0, '', midi(38))],
        QUARTERS,
        { tracks: [drums] },
      ),
    );
    expect(kit.score.tracks[0]?.kind).toBe('drums');
    const piano = read(
      oneBar([beat('0', '0', '0')], [note('0', 0, -2, '', midi(38))], QUARTERS, {
        tracks: [guitarTrack('0', { program: 0 })],
      }),
    );
    expect(piano.score.tracks[0]?.kind).toBe('pitched');
    for (const result of [clean, kit, piano]) expect(offFretboard(result)).toHaveLength(0);
  });

  it('keeps the own MIDI value of a note tied from a beat with two notes on its string', () => {
    const result = read(
      oneBar(
        [beat('0', '0', '0 1'), beat('1', '0', '2')],
        [
          note('0', 2, 5, '', midi(55)),
          note('1', 2, 7, '', midi(57)),
          note('2', 2, 5, '<Tie origin="false" destination="true" />', midi(55)),
        ],
        QUARTERS,
      ),
    );
    expect(midis(result, 1)).toEqual([55]);
    expect(codes(result)).not.toContain('tie-pitch');
    expect(codes(result)).not.toContain('tie-target');
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
    // A fifth quarter in a 4/4 bar.
    const beats = ['0', '1', '2', '3', '4'].map((id) => beat(id, '0', id));
    const notes = ['0', '1', '2', '3', '4'].map((id) => note(id, 2, 5));
    const { warnings } = read(oneBar(beats, notes, QUARTERS));
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'voice-overfull' }));
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
