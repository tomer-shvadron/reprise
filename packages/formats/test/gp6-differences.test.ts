import { describe, expect, it } from 'vitest';

import { gp6DrumSound } from '../src/gpx/gp6-drums';
import { readGpx, type GpxReadResult } from '../src/index';
import { beat, guitarTrack, note, oneBar, property, rhythm } from '../src/gpif/test/gpif-builder';
import { gpx } from './gpx-builder';

const QUARTERS = [rhythm('0', 'Quarter')];
const GP6_DRUMS = guitarTrack('0', {
  extra: '<GeneralMidi table="Percussion"><Program>0</Program></GeneralMidi>',
});

const read = (xml: string): GpxReadResult => readGpx(gpx({ 'score.gpif': xml }));

/** A GP6 drum note: no `InstrumentArticulation`, an input `Midi` number, element and variation. */
const drum = (id: string, midi: number, element: number, variation: number): string =>
  note(
    id,
    0,
    0,
    '',
    property('Midi', `<Number>${String(midi)}</Number>`) +
      property('Element', `<Element>${String(element)}</Element>`) +
      property('Variation', `<Variation>${String(variation)}</Variation>`),
  );

function drumSounds(notes: string[]): { frets: number[]; result: GpxReadResult } {
  const ids = notes.map((_, index) => String(index)).join(' ');
  const result = read(oneBar([beat('0', '0', ids)], notes, QUARTERS, { tracks: [GP6_DRUMS] }));
  const frets = result.score.tracks[0]?.bars[0]?.voices[0].beats[0]?.notes.map((n) => n.fret);
  return { frets: frets ?? [], result };
}

describe('GP6 drum notes', () => {
  it('take their GM sound from the element and variation', () => {
    const { frets, result } = drumSounds([
      drum('0', 36, 0, 0), // kick
      drum('1', 38, 1, 0), // snare
      drum('2', 37, 1, 2), // side stick
      drum('3', 42, 10, 0), // closed hi-hat
      drum('4', 46, 10, 2), // open hi-hat
      drum('5', 51, 15, 0), // ride
    ]);
    expect(result.score.tracks[0]?.kind).toBe('drums');
    expect(frets).toEqual([35, 38, 37, 42, 46, 51]);
    expect(result.warnings.map((w) => w.code)).not.toContain('drum-articulation');
  });

  it('map a variant past GM to its piece and report it once per track', () => {
    const { frets, result } = drumSounds([
      drum('0', 91, 1, 1), // snare rim shot
      drum('1', 93, 15, 1), // ride edge
    ]);
    expect(frets).toEqual([38, 51]);
    const variants = result.warnings.filter((w) => w.code === 'drum-articulation');
    expect(variants).toHaveLength(1);
    expect(variants[0]?.count).toBe(2);
    expect(result.warnings.map((w) => w.code)).not.toContain('invalid-value');
  });

  it('keep the MIDI number of a pair outside the kit and report it once per track', () => {
    const { frets, result } = drumSounds([drum('0', 40, 17, 0), drum('1', 40, 0, 5)]);
    expect(frets).toEqual([40, 40]);
    const unknown = result.warnings.filter((w) => w.code === 'unknown-value');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ count: 2, path: 'Notes/Note[0]' });
  });

  it('leave a note with an articulation to the GP7 path', () => {
    // Element 0 alone would be the GP6 kick (35); the articulation says snare (38).
    const gp7Kit = guitarTrack('0').replace(
      /<InstrumentSet>.*?<\/InstrumentSet>/,
      '<InstrumentSet><Name>Drums</Name><Type>drumKit</Type><LineCount>5</LineCount><Elements><Element><Name>Snare</Name><Articulations><Articulation><Name>Hit</Name><InputMidiNumbers>38</InputMidiNumbers><OutputMidiNumber>38</OutputMidiNumber></Articulation></Articulations></Element></Elements></InstrumentSet>',
    );
    const xml = oneBar(
      [beat('0', '0', '0')],
      [
        note(
          '0',
          0,
          0,
          '<InstrumentArticulation>0</InstrumentArticulation>',
          property('Element', '<Element>0</Element>') +
            property('Variation', '<Variation>0</Variation>'),
        ),
      ],
      QUARTERS,
      { tracks: [gp7Kit] },
    );
    expect(read(xml).score.tracks[0]?.bars[0]?.voices[0].beats[0]?.notes[0]?.fret).toBe(38);
  });

  it('are only remapped on drum tracks', () => {
    const xml = oneBar([beat('0', '0', '0')], [drum('0', 40, 1, 0)], QUARTERS);
    const first = read(xml).score.tracks[0]?.bars[0]?.voices[0].beats[0]?.notes[0];
    expect(first).toMatchObject({ string: 6, fret: 0 });
  });

  it('cover every element of the GP6 kit with three variations', () => {
    for (let element = 0; element < 17; element++) {
      for (let variation = 0; variation < 3; variation++) {
        const sound = gp6DrumSound(element, variation);
        expect(sound).toBeGreaterThanOrEqual(35);
        expect(sound).toBeLessThanOrEqual(59);
      }
    }
    expect(gp6DrumSound(17, 0)).toBeUndefined();
    expect(gp6DrumSound(0, 3)).toBeUndefined();
  });
});

describe('GP6-only elements', () => {
  it('reads a note-level accidental unless ConcertPitch spells one', () => {
    const concert = property(
      'ConcertPitch',
      '<Pitch><Step>D</Step><Accidental>#</Accidental><Octave>3</Octave></Pitch>',
    );
    const { score, warnings } = read(
      oneBar(
        [beat('0', '0', '0 1 2')],
        [
          note('0', 2, 1, '<Accidental>Flat</Accidental>'),
          note('1', 3, 1, '<Accidental>Sharp</Accidental>', concert),
          note('2', 4, 1, '<Accidental>Weird</Accidental>'),
        ],
        QUARTERS,
      ),
    );
    expect(score.tracks[0]?.bars[0]?.voices[0].beats[0]?.notes.map((n) => n.accidental)).toEqual([
      'flat',
      'sharp',
      undefined,
    ]);
    expect(warnings.filter((w) => w.code === 'unknown-value').map((w) => w.path)).toEqual([
      'Notes/Note[2]/Accidental',
    ]);
  });

  it('drops a beat sound bank and the track AutoBrush as not modelled', () => {
    const track = guitarTrack('0', {
      extra: `<Properties>${property('AutoBrush', '<Enable />')}</Properties>`,
    });
    const { warnings } = read(
      oneBar([beat('0', '0', '', '<Bank>D-Steel</Bank>')], [], QUARTERS, { tracks: [track] }),
    );
    expect(warnings.map((w) => [w.code, w.path])).toEqual(
      expect.arrayContaining([
        ['not-modelled', 'Beats/Beat[0]/Bank'],
        ['not-modelled', 'Tracks/Track[0]/Properties/Property[AutoBrush]'],
      ]),
    );
    expect(warnings.map((w) => w.code)).not.toContain('unknown-element');
  });
});
