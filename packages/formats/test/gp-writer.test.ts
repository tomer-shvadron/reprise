import { ScoreSchema, validateScore, type MixerChange, type Score } from '@reprise/model';
import { fullScore, largeScore, note, score } from '@reprise/model/testing';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { readGp, readGp3To5, readGpx, writeGp, writeGpif, type GpifDropCode } from '../src/index';
import { readPartConfiguration } from '../src/gpif/part-configuration';
import { fixtureBytes, manifestEntries } from './corpus';
import { roundTripView } from './gp-round-trip';
import { twoStaffGp } from './merged-staves-gp';
import { kitchenSink } from './kitchen-sink';
import { overfullBarScore } from './overfull-bar';

/**
 * What our own reader reports about every file the writer makes: the Guitar Pro elements the
 * writer adds so Guitar Pro plays the file (channel strip, MIDI channels, audio engine), which
 * the model does not keep.
 */
const WRITER_ELEMENTS = [
  'not-modelled:Tracks/Track[0]/RSE',
  'not-modelled:Tracks/Track[0]/MidiConnection',
  'not-modelled:Tracks/Track[0]/AudioEngineState',
];

function roundTrip(source: Score) {
  const written = writeGp(source);
  const read = readGp(written.bytes);
  return { ...written, ...read };
}

const violations = (score: Score): string[] =>
  validateScore(score).map((violation) => violation.rule);

describe('the gp writer round trip', () => {
  describe.each(manifestEntries(['gp']).map((entry) => entry.path))('fixture %s', (path) => {
    const source = readGp(fixtureBytes(path)).score;
    const result = roundTrip(source);

    it('drops nothing', () => {
      expect(result.dropped).toEqual([]);
    });

    it('reads back with no warnings but the writer elements and the source invariants', () => {
      expect(result.warnings.map((warning) => `${warning.code}:${warning.path}`)).toEqual([
        ...WRITER_ELEMENTS,
        ...validateScore(source).map(
          (violation) =>
            `${violation.rule}:${['score', ...violation.path].join('.').replaceAll(/\.(\d+)/g, '[$1]')}`,
        ),
      ]);
    });

    it('reads back the same score', () => {
      expect(roundTripView(result.score)).toEqual(roundTripView(source));
    });
  });

  it('carries every feature gpif can on every kind of track', () => {
    const source = kitchenSink();
    const result = roundTrip(source);
    expect(result.dropped).toEqual([]);
    // The reader flags a ramp that starts mid-bar, though it places it where the source had it.
    expect(result.warnings.map((warning) => `${warning.code}:${warning.path}`)).toEqual([
      ...WRITER_ELEMENTS,
      'not-modelled:MasterTrack/Automations/Automation',
    ]);
    expect(ScoreSchema.safeParse(result.score).success).toBe(true);
    expect(violations(result.score)).toEqual([]);
    expect(roundTripView(result.score)).toEqual(roundTripView(source));
  });

  it.each([
    ['plain', largeScore(4, 64)],
    ['structured', largeScore(4, 64, { structure: true })],
  ])(
    'reads back a %s large score unchanged',
    (_, source) => {
      const result = roundTrip(source);
      expect(result.dropped).toEqual([]);
      expect(roundTripView(result.score)).toEqual(roundTripView(source));
    },
    30_000,
  );

  it('drops exactly the known set from fullScore and keeps the rest', () => {
    const source = fullScore();
    const result = roundTrip(source);
    expect(result.dropped.map((entry) => [entry.code, entry.path])).toEqual([
      ['section-color', 'score.masterBars[0].section.color'],
      ['channel-effect', 'score.tracks[0].channel'],
      ['sound-override', 'score.tracks[0].sound'],
      ['chord-barre', 'score.tracks[0]'],
      ['mixer-change', 'score.tracks[0].bars[0].voices[0].beats[0].mix'],
      ['stroke', 'score.tracks[0].bars[0].voices[0].beats[0].effects.arpeggio'],
      ['note-dynamics', 'score.tracks[0].bars[0].voices[0].beats[0]'],
      ['trill-speed', 'score.tracks[0].bars[0].voices[0].beats[0].notes[0].trill.speed'],
    ]);

    // The source with exactly those losses applied.
    const expected = structuredClone(source);
    const [first] = expected.masterBars;
    const [guitar] = expected.tracks;
    const beat = guitar?.bars[0]?.voices[0].beats[0];
    if (!first?.section || !guitar || !beat?.chord?.diagram || !beat.effects.arpeggio) {
      throw new Error('fullScore changed shape');
    }
    delete first.section.color;
    guitar.channel.reverb = 0;
    delete guitar.sound;
    delete beat.chord.diagram.barres;
    beat.mix = {
      ...(beat.mix?.program !== undefined && { program: beat.mix.program }),
      ...(beat.mix?.tempo && { tempo: beat.mix.tempo }),
    };
    delete beat.effects.arpeggio;
    const [bent, other] = beat.notes;
    if (!bent?.trill || !other) throw new Error('fullScore changed shape');
    other.dynamics = bent.dynamics;
    bent.trill.speed = 16;
    expect(roundTripView(result.score)).toEqual(roundTripView(expected));
  });

  it('writes the same bytes for the same score', () => {
    const source = kitchenSink();
    expect(writeGp(source).bytes).toEqual(writeGp(source).bytes);
  });
});

/**
 * The binary fixtures carry what gpif cannot: GP5's coloured markers, its empty beats, and bend
 * and whammy curves of more than four points. Everything else survives, and a gpx score (the
 * same document in GP6's container) loses nothing.
 */
describe('a gp3, gp4, gp5 or gpx score exported to gp', () => {
  const CROSS_FORMAT_LOSSES: GpifDropCode[] = [
    'section-color',
    'empty-beat',
    'bend-shape',
    'whammy-shape',
  ];

  /** The source with those losses applied, as the writer's dropped list announces them. */
  function expectedAfterExport(source: Score): Score {
    const expected = structuredClone(source);
    for (const masterBar of expected.masterBars) delete masterBar.section?.color;
    for (const track of expected.tracks) {
      for (const bar of track.bars) {
        for (const voice of bar.voices) {
          const empty = (beat: (typeof voice.beats)[number]) =>
            !beat.rest && beat.notes.length === 0 && (beat.grace ?? []).length === 0;
          if (voice.beats.every(empty)) voice.beats = [];
          for (const beat of voice.beats) {
            if (empty(beat)) beat.rest = true;
            delete beat.effects.whammy;
            for (const played of beat.notes) delete played.bend;
          }
        }
      }
    }
    return expected;
  }

  function withoutCurves(score: Score): Score {
    const copy = structuredClone(score);
    for (const track of copy.tracks) {
      for (const bar of track.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            delete beat.effects.whammy;
            for (const played of beat.notes) delete played.bend;
          }
        }
      }
    }
    return copy;
  }

  const binary = manifestEntries(['gp3', 'gp4', 'gp5']).map((entry): [string, () => Score] => [
    entry.path,
    () => readGp3To5(fixtureBytes(entry.path)).score,
  ]);
  const gpx = manifestEntries(['gpx']).map((entry): [string, () => Score] => [
    entry.path,
    () => readGpx(fixtureBytes(entry.path)).score,
  ]);

  it.each([...binary, ...gpx])('%s', (_, build) => {
    const source = build();
    const result = roundTrip(source);
    for (const entry of result.dropped) expect(CROSS_FORMAT_LOSSES).toContain(entry.code);
    expect(roundTripView(withoutCurves(result.score))).toEqual(
      roundTripView(expectedAfterExport(source)),
    );
  });
});

describe('what the writer reports as dropped', () => {
  const dropsOf = (source: Score): GpifDropCode[] => writeGpif(source).dropped.map((d) => d.code);
  const base = () => score().track('guitar').bar();

  it.each<[GpifDropCode, () => Score]>([
    [
      'section-color',
      () =>
        base()
          .section('A', { color: '#ff0000' })
          .beat('1', [note(1, 0)])
          .build(),
    ],
    [
      'channel-effect',
      () =>
        score()
          .track('guitar', {
            channel: {
              volume: 100,
              pan: 64,
              chorus: 10,
              reverb: 0,
              phaser: 0,
              tremolo: 0,
              mute: false,
              solo: false,
            },
          })
          .bar()
          .build(),
    ],
    [
      'mixer-change',
      () =>
        base()
          .beat('1', [note(1, 0)], { mix: { volume: { value: 10 } } })
          .build(),
    ],
    [
      'sound-override',
      () =>
        score()
          .track('guitar', { sound: { preset: 'clean' } })
          .bar()
          .build(),
    ],
    [
      'note-dynamics',
      () =>
        base()
          .beat('1', [note(1, 0, { dynamics: 'p' }), note(2, 0)])
          .build(),
    ],
    [
      'stroke',
      () =>
        base()
          .beat('1', [note(1, 0)], {
            effects: { brush: { direction: 'up' }, arpeggio: { direction: 'up' } },
          })
          .build(),
    ],
    [
      'fade',
      () =>
        base()
          .beat('1', [note(1, 0)], { effects: { fadeIn: true, fadeOut: true } })
          .build(),
    ],
    [
      'tapping-without-notes',
      () =>
        base()
          .rest('1', { effects: { tapping: true } })
          .build(),
    ],
    [
      'empty-beat',
      () =>
        base()
          .beat('2', [note(1, 0)])
          .beat('2', [])
          .build(),
    ],
    [
      'bend-shape',
      () =>
        base()
          .beat('1', [
            note(1, 5, {
              bend: {
                kind: 'bendReleaseBend',
                points: [
                  { position: 0, value: 0 },
                  { position: 15, value: 4 },
                  { position: 30, value: 0 },
                  { position: 45, value: 4 },
                  { position: 60, value: 4 },
                ],
              },
            }),
          ])
          .build(),
    ],
    [
      'whammy-shape',
      () =>
        base()
          .beat('1', [note(1, 0)], {
            effects: {
              whammy: {
                kind: 'custom',
                points: [
                  { position: 0, value: 0 },
                  { position: 60, value: -4 },
                ],
              },
            },
          })
          .build(),
    ],
    [
      'trill-speed',
      () =>
        base()
          .beat('1', [note(1, 0, { trill: { fret: 2, speed: 64 } })])
          .build(),
    ],
    [
      'trill-range',
      () =>
        base()
          .beat('1', [note(1, 0, { trill: { fret: 127, speed: 16 } })])
          .build(),
    ],
    [
      'chord-barre',
      () =>
        base()
          .beat('1', [note(1, 1)], {
            chord: {
              name: 'F',
              diagram: {
                baseFret: 1,
                frets: [1, 1, 2, 3, 3, 1],
                barres: [{ fret: 1, firstString: 1, lastString: 6 }],
              },
            },
          })
          .build(),
    ],
    [
      'volta-bracket',
      () =>
        score()
          .track('guitar')
          .bar()
          .repeatStart()
          .bar()
          .volta([3])
          .bar()
          .bar()
          .repeatEnd()
          .build({ validate: false }),
    ],
    ['anacrusis', () => score().track('guitar').bar().bar().anacrusis().build()],
    [
      'notation',
      () =>
        score()
          .track('guitar', {
            program: 0,
            display: { notation: 'standard', clef: 'treble', octaveShift: 1 },
          })
          .bar()
          .build(),
    ],
    ['capo', () => score().track('piano', { capo: 2 }).bar().build({ validate: false })],
    [
      'tempo-ramp',
      () =>
        base()
          .beat('2', [note(1, 0)], { mix: { tempo: { bpm: 90, duration: 4 } } })
          .beat('2', [note(1, 0)], { mix: { tempo: { bpm: 100 } } })
          .bar()
          .build(),
    ],
    [
      'tempo-collision',
      () =>
        base()
          .beat('1', [note(1, 0)], { mix: { tempo: { bpm: 90 } } })
          .build(),
    ],
    [
      'notices',
      () =>
        score()
          .meta({ notices: ['two\nlines'] })
          .track('guitar')
          .bar()
          .build(),
    ],
    ['text-characters', () => score().title('bell\u0007').track('guitar').bar().build()],
  ])('%s', (code, build) => {
    expect(dropsOf(build())).toEqual([code]);
  });
});

describe('the gpif document', () => {
  const notesOf = (xml: string): string[] =>
    xml.slice(xml.indexOf('<Notes>\n'), xml.indexOf('</Notes>\n<Rhythms>')).split('<Note id=');

  it('flags both ends of a hammer-on and a tie, as Guitar Pro does', () => {
    const { xml } = writeGpif(
      score()
        .track('guitar')
        .bar()
        .beat('4', [note(1, 5)])
        .beat('4', [note(2, 0)])
        .beat('4', [note(1, 7, { hammerPull: true })])
        .beat('4', [note(1, 7, { tie: true })])
        .build(),
    );
    const notes = notesOf(xml);
    expect(notes[1]).toContain('HopoOrigin');
    expect(notes[1]).toContain('<InstrumentArticulation>0</InstrumentArticulation>');
    expect(notes[2]).not.toContain('Hopo');
    expect(notes[3]).toContain('HopoDestination');
    expect(notes[3]).toContain('<Tie origin="true" destination="false" />');
    expect(notes[4]).toContain('<Tie origin="false" destination="true" />');
  });

  it("flags a tie's origin where the model finds it, past rests and other strings", () => {
    const { xml } = writeGpif(
      score()
        .track('guitar')
        .bar()
        .beat('4', [note(6, 3)])
        .rest('4')
        .beat('4', [note(1, 0)])
        .beat('4', [note(6, 3, { tie: true })])
        .build(),
    );
    const notes = notesOf(xml);
    expect(notes[1]).toContain('<Tie origin="true" destination="false" />');
    expect(notes[2]).not.toContain('<Tie');
    expect(notes[3]).toContain('<Tie origin="false" destination="true" />');
  });

  it('leaves a voice of nothing but empty beats out, without reporting it', () => {
    const { xml, dropped } = writeGpif(score().track('guitar').bar().beat('1', []).build());
    expect(dropped).toEqual([]);
    expect(xml).toContain('<Voices>-1 -1 -1 -1</Voices>');
  });

  it("groups drum articulations under Guitar Pro's elements, the rest in an unpitched one", () => {
    const { xml } = writeGpif(kitchenSink());
    const elements = [
      ...xml.matchAll(/<Element>\n<Name>([^<]*)<\/Name>\n<Type>([^<]*)<\/Type>/g),
    ].map((match) => match.slice(1, 3));
    const names = elements.map(([name]) => name);
    expect(names.indexOf('Snare')).toBeLessThan(names.indexOf('Kick Drum'));
    expect(names.indexOf('Kick Drum')).toBeLessThan(names.indexOf('Percussion'));
    expect(elements).toContainEqual(['Percussion', 'unpitched']);
    expect(elements.some(([, type]) => type === 'drumKit')).toBe(false);
    expect(xml).toContain('<InputMidiNumbers>20</InputMidiNumbers>');
    expect(xml).toContain('finger="Rank"');
  });

  it('marks a volta bracket on its first bar only', () => {
    const { xml } = writeGpif(
      score()
        .track('guitar')
        .bar()
        .repeatStart()
        .bar()
        .volta([1])
        .bar()
        .volta([1])
        .repeatEnd()
        .bar()
        .volta([2])
        .build(),
    );
    expect(xml.match(/<AlternateEndings>[^<]*<\/AlternateEndings>/g)).toEqual([
      '<AlternateEndings>1</AlternateEndings>',
      '<AlternateEndings>2</AlternateEndings>',
    ]);
  });

  it('writes a tempo ramp as a pair of automations, the second linear', () => {
    const { xml } = writeGpif(
      score()
        .tempo(100)
        .track('guitar')
        .bar()
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)], {
          mix: { tempo: { bpm: 150, unit: 'dottedQuarter', duration: 1 } },
        })
        .beat('2', [note(1, 0)])
        .bar()
        .build(),
    );
    const automations = [
      ...xml.matchAll(
        /<Linear>(\w+)<\/Linear>\n<Bar>(\d+)<\/Bar>\n<Position>([\d.]+)<\/Position>\n<Visible>true<\/Visible>\n<Value>([^<]+)<\/Value>/g,
      ),
    ].map((match) => match.slice(1));
    expect(automations).toEqual([
      ['false', '0', '0', '100 2'],
      ['false', '0', '0.25', '100 2'],
      ['true', '0', '0.5', '100 3'],
    ]);
  });

  it('deduplicates rhythms and chord diagrams', () => {
    const chord = { name: 'E', diagram: { baseFret: 1, frets: [0, 0, 1, 2, 2, 0] } };
    const { xml } = writeGpif(
      score()
        .track('guitar')
        .bar()
        .beat('4', [note(1, 0)], { chord })
        .beat('4', [note(1, 0)], { chord: structuredClone(chord) })
        .beat('8t', [note(1, 0)])
        .beat('8t', [note(1, 0)])
        .beat('8t', [note(1, 0)])
        .rest('4')
        .build(),
    );
    expect(xml.match(/<Rhythm id=/g)).toHaveLength(2);
    expect(xml.match(/<Item id=/g)).toHaveLength(1);
    expect(xml.match(/<Chord>0<\/Chord>/g)).toHaveLength(2);
  });
});

describe('an over-full bar', () => {
  const AUTOMATION =
    /<Linear>(\w+)<\/Linear>\n<Bar>(\d+)<\/Bar>\n<Position>([\d.]+)<\/Position>\n<Visible>true<\/Visible>\n<Value>([^<]+)<\/Value>/g;
  const automationsOf = (xml: string): string[][] =>
    [...xml.matchAll(AUTOMATION)].map((match) => match.slice(1));
  const beatsOf = (result: { score: Score }, bar = 0) =>
    result.score.tracks[0]?.bars[bar]?.voices[0]?.beats ?? [];
  const sixQuarters = (mixes: Partial<Record<number, MixerChange>>): Score => {
    let builder = score().tempo(120).track('guitar').bar();
    for (let index = 0; index < 6; index++) {
      const mix = mixes[index];
      builder = builder.beat('4', [note(1, index)], mix ? { mix } : {});
    }
    builder = builder.bar();
    for (let index = 0; index < 4; index++) builder = builder.beat('4', [note(1, index)]);
    return builder.build({ validate: false });
  };

  it('keeps tempo changes on the overflow in their own bar', () => {
    const source = overfullBarScore();
    const result = roundTrip(source);
    expect(result.dropped).toEqual([]);
    expect(result.warnings.map((warning) => `${warning.code}:${warning.path}`)).toEqual([
      ...WRITER_ELEMENTS,
      'not-modelled:MasterTrack/Automations/Automation',
      'voice-overfull:score.tracks[0].bars[0].voices[0]',
    ]);
    const beats = beatsOf(result);
    expect(beats[2]?.mix?.tempo).toEqual({ bpm: 100, duration: 2 });
    expect(beats[4]?.mix?.tempo).toEqual({ bpm: 100 });
    expect(beats[5]?.mix?.tempo).toEqual({ bpm: 60 });
    expect(result.score.masterBars[1]?.tempo).toBeUndefined();
    expect(roundTripView(result.score)).toEqual(roundTripView(source));
  });

  it('writes them at their offset over the written length', () => {
    expect(automationsOf(writeGpif(overfullBarScore()).xml)).toEqual([
      ['false', '0', '0', '120 2'],
      ['false', '0', '0.5', '120 2'],
      ['true', '0', '1', '100 2'],
      ['false', '0', '1.25', '60 2'],
    ]);
  });

  it('measures a ramp across an over-full bar by its longest voice', () => {
    const source = sixQuarters({ 4: { tempo: { bpm: 60, duration: 4 } } });
    expect(automationsOf(writeGpif(source).xml)).toEqual([
      ['false', '0', '0', '120 2'],
      ['false', '0', '1', '120 2'],
      ['true', '1', '0.5', '60 2'],
    ]);
    const result = roundTrip(source);
    expect(result.dropped).toEqual([]);
    expect(beatsOf(result)[4]?.mix?.tempo).toEqual({ bpm: 60, duration: 4 });
    expect(beatsOf(result, 1)[2]?.mix?.tempo).toEqual({ bpm: 60 });
    expect(roundTripView(result.score)).toEqual(roundTripView(source));
  });

  it('keeps a program change on the overflow on its beat', () => {
    const source = sixQuarters({ 5: { program: 30 } });
    const result = roundTrip(source);
    const beats = beatsOf(result);
    expect(beats[5]?.mix).toEqual({ program: 30 });
    expect(beats[4]?.mix).toBeUndefined();
    expect(roundTripView(result.score)).toEqual(roundTripView(source));
  });
});

describe('the gp zip', () => {
  const source = kitchenSink();
  const entries = unzipSync(writeGp(source).bytes);

  it("holds Guitar Pro's entries in Guitar Pro's order", () => {
    expect(Object.keys(entries)).toEqual([
      'Content/',
      'Content/BinaryStylesheet',
      'Content/LayoutConfiguration',
      'Content/PartConfiguration',
      'Content/Preferences.json',
      'Content/score.gpif',
      'VERSION',
    ]);
    expect(new TextDecoder().decode(entries['VERSION'])).toBe('7.0');
  });

  it('records each track’s notation in the part configuration, one view per track after the score', () => {
    const bytes = entries['Content/PartConfiguration'] ?? new Uint8Array();
    expect(readPartConfiguration(bytes)).toEqual([
      { standard: true, tab: true },
      { standard: false, tab: true },
      { standard: true, tab: false },
      { standard: true, tab: false },
      { standard: true, tab: false },
    ]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt32(0)).toBe(6);
    expect(bytes.byteLength).toBe(4 + (1 + 4 + 5) + 5 * (1 + 4 + 1) + 4);
  });

  it('sizes the layout configuration to the part configuration', () => {
    expect(entries['Content/LayoutConfiguration']?.byteLength).toBe(4 + 1 + 1 + 5 * 2 + 4);
  });
});

describe('a merged second staff', () => {
  it('survives a write and a read as the same MIDI values in the same slots', () => {
    const first = readGp(twoStaffGp());
    const written = writeGp(first.score);
    const again = readGp(written.bytes);
    expect(written.dropped).toEqual([]);
    const pitches = (score: Score) =>
      score.tracks[0]?.bars[0]?.voices.map((voice) =>
        voice.beats.map((b) => b.notes.map((n) => n.fret)),
      );
    expect(again.score.tracks[0]?.kind).toBe('pitched');
    expect(again.score.tracks[0]?.tuning).toEqual(first.score.tracks[0]?.tuning);
    expect(pitches(again.score)).toEqual(pitches(first.score));
    expect(pitches(again.score)?.[1]).toEqual([[33]]);
  });
});

describe('writing a large score', () => {
  it('writes 8 tracks by 300 bars without losses, under a megabyte', { timeout: 30_000 }, () => {
    const source = largeScore(8, 300);
    writeGp(source);
    const start = performance.now();
    const { bytes, dropped } = writeGp(source);
    const elapsed = performance.now() - start;
    const xml = new TextDecoder().decode(unzipSync(bytes)['Content/score.gpif']);
    // 281 ms warm on an Apple M4 Pro, 1.7 s under three parallel runs, about 2.6 s on a loaded CI
    // runner; the bound only catches a pathological regression.
    expect(elapsed).toBeLessThan(10_000);
    expect(dropped).toEqual([]);
    expect(bytes.byteLength).toBeLessThan(1_000_000);
    expect(xml.length).toBeGreaterThan(bytes.byteLength);
  });
});
