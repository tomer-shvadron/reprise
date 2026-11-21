import { STANDARD_TUNING, createTrack, stringInstrumentOf, type Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  changeKind,
  coursesSummary,
  droppedStringsMessage,
  formFromTrack,
  newTrackForm,
  percussionForm,
  newTrackProperties,
  noteLabel,
  presetNameOf,
  setName,
  setShortName,
  setString,
  setStringCount,
  shortNameOf,
  trackChanges,
  trackHasNotes,
  validateTrackForm,
} from './track-form';

const guitar = (): Track => createTrack('fretted', { barCount: 2 });

const DEFAULTS = { strings: 'tab', vocals: 'tab' } as const;

describe('formFromTrack', () => {
  it('lists the strings highest first, the reverse of the model, and flips them back', () => {
    const track = guitar();
    const form = formFromTrack(track);
    expect(form.strings).toEqual([64, 59, 55, 50, 45, 40]);
    expect(trackChanges(track, form)).toEqual({});
    expect(trackChanges(track, setString(form, 6, 38))).toEqual({
      tuning: [38, 45, 50, 55, 59, 64],
    });
  });

  it('names the tuning from the table, and Custom (undefined) for anything else', () => {
    const form = formFromTrack(guitar());
    expect(presetNameOf(form)).toBe('E standard');
    expect(presetNameOf(setString(form, 1, 65))).toBeUndefined();
  });

  it('leaves an imported name’s spacing alone until the text changes', () => {
    const padded = createTrack('fretted', { name: ' Lead ', shortName: ' Ld ' });
    const form = { ...formFromTrack(padded), capo: '2' };
    expect(trackChanges(padded, form)).toEqual({ capo: 2 });
    expect(trackChanges(padded, { ...form, name: ' Lead2 ' })).toMatchObject({ name: 'Lead2' });
  });

  it('writes only the keys that changed', () => {
    const track = guitar();
    const form = { ...formFromTrack(track), name: ' Lead ', capo: '2', color: '#ABCDEF' };
    expect(trackChanges(track, form)).toEqual({ name: 'Lead', capo: 2, color: '#abcdef' });
  });
});

describe('the short name', () => {
  it('follows the name until it is edited', () => {
    let form = newTrackForm('fretted');
    form = setName(form, 'Rhythm');
    expect(form.shortName).toBe('Rhyt.');
    form = setShortName(form, 'Rh');
    form = setName(form, 'Lead');
    expect(form.shortName).toBe('Rh');
    expect(shortNameOf('  ')).toBe('');
  });
});

describe('the string count', () => {
  const withTuning = (tuning: number[]) => formFromTrack(createTrack('fretted', { tuning }));

  it('lands on the table names by plain add and drop', () => {
    const seven = setStringCount(formFromTrack(guitar()), 7);
    expect(seven.strings).toEqual([64, 59, 55, 50, 45, 40, 35]);
    expect(presetNameOf(seven)).toBe('7-string standard');
    const bass = withTuning([28, 33, 38, 43]);
    expect(setStringCount(bass, 5).strings).toEqual([43, 38, 33, 28, 23]);
    expect(presetNameOf(setStringCount(bass, 5))).toBe('5-string bass standard');
    expect(presetNameOf(setStringCount(seven, 6))).toBe('E standard');
  });

  it('never retunes the strings that stay: D standard 6→7', () => {
    const d = withTuning([38, 43, 48, 53, 57, 62]);
    expect(setStringCount(d, 7).strings).toEqual([62, 57, 53, 48, 43, 38, 33]);
  });

  it('keeps a custom bass a bass: 4→6 adds fourths below the lowest', () => {
    const custom = withTuning([27, 32, 37, 42]);
    expect(setStringCount(custom, 6).strings).toEqual([42, 37, 32, 27, 22, 17]);
    expect(setStringCount(custom, 3).strings).toEqual([42, 37, 32]);
  });

  it('is a no-op for the same count', () => {
    const six = formFromTrack(guitar());
    expect(setStringCount(six, 6)).toBe(six);
  });
});

describe('add mode', () => {
  it('starts from the model defaults with nothing edited', () => {
    const form = newTrackForm('fretted');
    expect(form).toMatchObject({ kind: 'fretted', name: 'Guitar', program: 25, capo: '0' });
    expect(newTrackForm('drums').strings).toEqual([]);
  });

  it('lets a bass preset rename, re-short and re-program what is untouched', () => {
    const form = applyPreset(newTrackForm('fretted'), 'Bass standard', true);
    expect(form).toMatchObject({ name: 'Bass', shortName: 'Bs.', program: 33 });
    expect(
      applyPreset(setName(newTrackForm('fretted'), 'Mine'), 'Bass standard', true),
    ).toMatchObject({
      name: 'Mine',
      shortName: 'Mine.',
    });
    expect(applyPreset(form, 'Ukulele standard', true).program).toBe(24);
  });

  it('names a new 6-string bass and an 8-string guitar from their presets', () => {
    expect(applyPreset(newTrackForm('fretted'), '6-string bass standard', true)).toMatchObject({
      name: 'Bass',
      shortName: 'Bs.',
      program: 33,
      strings: [48, 43, 38, 33, 28, 23],
    });
    const eight = applyPreset(newTrackForm('fretted'), '8-string standard', true);
    expect(eight).toMatchObject({ name: 'Guitar', program: 25 });
    expect(eight.strings).toHaveLength(8);
  });

  it('does not touch the name when editing an existing track', () => {
    const edited = applyPreset(formFromTrack(guitar()), 'Bass standard', false);
    expect(edited.name).toBe('Guitar');
  });

  it('builds addTrack properties with strings and capo only for a fretted track', () => {
    expect(newTrackProperties({ ...newTrackForm('fretted'), capo: '2' }, DEFAULTS)).toMatchObject({
      tuning: [...STANDARD_TUNING],
      capo: 2,
    });
    expect(newTrackProperties(newTrackForm('drums'), DEFAULTS)).not.toHaveProperty('tuning');
  });

  it('gives a new fretted track the strings default and a vocal one the vocals default', () => {
    const defaults = { strings: 'both', vocals: 'standard' } as const;
    const fretted = newTrackForm('fretted');
    expect(newTrackProperties(fretted, defaults).display?.notation).toBe('both');
    expect(newTrackProperties({ ...fretted, program: 53 }, defaults).display?.notation).toBe(
      'standard',
    );
    expect(
      newTrackProperties({ ...fretted, name: 'Lead Vocals' }, defaults).display?.notation,
    ).toBe('standard');
    expect(newTrackProperties(newTrackForm('drums'), defaults)).not.toHaveProperty('display');
    expect(newTrackProperties(newTrackForm('pitched'), defaults)).not.toHaveProperty('display');
  });

  it('keeps a typed name across a kind change, and its short name', () => {
    const named = setName(newTrackForm('fretted'), 'Keys');
    expect(changeKind(named, 'pitched')).toMatchObject({
      kind: 'pitched',
      name: 'Keys',
      shortName: 'Keys.',
      nameEdited: true,
    });
    expect(changeKind(setShortName(named, 'K'), 'drums').shortName).toBe('K');
    expect(changeKind(newTrackForm('fretted'), 'drums').name).toBe('Drums');
  });

  it('turns the percussion choice into drums named Percussion, keeping a typed name', () => {
    expect(percussionForm(newTrackForm('fretted'))).toMatchObject({
      kind: 'drums',
      name: 'Percussion',
      shortName: 'Perc.',
      percussion: true,
    });
    expect(percussionForm(newTrackForm('drums')).name).toBe('Percussion');
    expect(percussionForm(setName(newTrackForm('fretted'), 'Congas')).name).toBe('Congas');
    expect(changeKind(percussionForm(newTrackForm('drums')), 'drums')).toMatchObject({
      name: 'Drums',
      percussion: false,
    });
  });

  it('keeps a chosen colour across a kind change', () => {
    const form = { ...newTrackForm('fretted'), color: '#123456' };
    expect(changeKind(form, 'drums')).toMatchObject({ kind: 'drums', color: '#123456' });
    expect(changeKind(newTrackForm('fretted'), 'drums').color).toBe(newTrackForm('drums').color);
  });
});

describe('validateTrackForm', () => {
  it('requires a name and a short name, a #rrggbb colour and a capo within the neck', () => {
    const form = {
      ...newTrackForm('fretted'),
      name: ' ',
      shortName: '',
      color: 'red',
      capo: '25',
    };
    expect(Object.keys(validateTrackForm(form)).sort()).toEqual([
      'capo',
      'color',
      'name',
      'shortName',
    ]);
    expect(validateTrackForm({ ...newTrackForm('fretted'), capo: '1.5' }).capo).toBeDefined();
    expect(validateTrackForm(newTrackForm('fretted'))).toEqual({});
  });

  it('lets an imported track keep the blank name and short name it came with', () => {
    const blank = createTrack('fretted', { name: '', shortName: '' });
    expect(validateTrackForm(formFromTrack(blank), blank)).toEqual({});
    expect(
      validateTrackForm({ ...formFromTrack(guitar()), name: '' }, guitar()).name,
    ).toBeDefined();
  });

  it('skips string and capo checks for a drum track', () => {
    expect(validateTrackForm({ ...newTrackForm('drums'), capo: 'x' })).toEqual({});
  });
});

describe('the notes on dropped strings', () => {
  const built = score()
    .track('guitar', { tuning: [35, 40, 45, 50, 55, 59, 64] })
    .bar()
    .beat('4', [note(1, 0), note(7, 3)])
    .bar()
    .beat('4', [note(6, 2)])
    .bar()
    .beat('4', [note(7, 1), note(6, 5)])
    .bar()
    .beat('4', [note(7, 1)])
    .build();
  const seven = built.tracks[0] ?? guitar();

  it('names the strings and bars', () => {
    expect(droppedStringsMessage(seven, 6)).toBe('String 7 has notes in bars 1, 3–4');
    expect(droppedStringsMessage(seven, 5)).toBe(
      'String 6 has notes in bars 2–3; String 7 has notes in bars 1, 3–4',
    );
  });

  it('is undefined when the dropped strings are empty', () => {
    expect(droppedStringsMessage(seven, 7)).toBeUndefined();
  });

  it('refuses the form that drops them', () => {
    const form = setStringCount(formFromTrack(seven), 6);
    expect(validateTrackForm(form, seven).strings).toMatch(/String 7 has notes in bars 1, 3–4/);
  });

  it('tells a track with notes from an empty one', () => {
    expect(trackHasNotes(built, built.tracks[0]?.id ?? '')).toBe(true);
    expect(trackHasNotes(score().track('guitar').bar().build(), 'x')).toBe(false);
  });
});

describe('noteLabel', () => {
  it.each([
    [40, 'E2'],
    [58, 'A♯3'],
    [60, 'C4'],
    [12, 'C0'],
  ])('%i is %s', (midi, label) => {
    expect(noteLabel(midi)).toBe(label);
  });
});

describe('doubled courses', () => {
  const twelve = () => applyPreset(newTrackForm('fretted'), '12-string standard', true);

  it('names a 12-string from its preset, not as E standard', () => {
    const form = twelve();
    expect(form).toMatchObject({
      name: '12-string Guitar',
      shortName: '12-str.',
      program: 25,
      strings: [64, 59, 55, 50, 45, 40],
      courses: [0, 0, 12, 12, 12, 12],
    });
    expect(presetNameOf(form)).toBe('12-string standard');
    // The same strings without the courses are the plain guitar's.
    expect(presetNameOf({ ...form, courses: undefined })).toBe('E standard');
  });

  it('reads a 12-string track back to the same form and no changes', () => {
    const track = createTrack('fretted', {
      tuning: [40, 45, 50, 55, 59, 64],
      courses: [12, 12, 12, 12, 0, 0],
    });
    const form = formFromTrack(track);
    expect(form.courses).toEqual([0, 0, 12, 12, 12, 12]);
    expect(presetNameOf(form)).toBe('12-string standard');
    expect(trackChanges(track, form)).toEqual({});
  });

  it('sends the courses with a new 12-string and clears them on a plain preset', () => {
    expect(newTrackProperties(twelve(), DEFAULTS)).toMatchObject({
      tuning: [40, 45, 50, 55, 59, 64],
      courses: [12, 12, 12, 12, 0, 0],
    });
    const track = createTrack('fretted', {
      tuning: [40, 45, 50, 55, 59, 64],
      courses: [12, 12, 12, 12, 0, 0],
    });
    const plain = applyPreset(formFromTrack(track), 'E standard', false);
    expect(plain.courses).toBeUndefined();
    expect(trackChanges(track, plain)).toEqual({ courses: null });
  });

  it('sets a mandolin from its preset: four unison courses, program 25', () => {
    const form = applyPreset(newTrackForm('fretted'), 'Mandolin GDAE', true);
    expect(form).toMatchObject({ name: 'Mandolin', shortName: 'Mand.', program: 25 });
    expect(form.courses).toEqual([0, 0, 0, 0]);
    const properties = newTrackProperties(form, DEFAULTS);
    expect(
      stringInstrumentOf({
        kind: 'fretted',
        program: 25,
        ...properties,
        tuning: [...form.strings].reverse(),
      }),
    ).toBe('mandolin');
  });

  it('carries a banjo preset with its drone, program and a banjo name', () => {
    const form = applyPreset(newTrackForm('fretted'), 'Banjo Open G', true);
    expect(form).toMatchObject({
      name: 'Banjo',
      shortName: 'Bjo.',
      program: 105,
      drone: { string: 5, fret: 5 },
    });
    expect(presetNameOf(form)).toBe('Banjo Open G');
    expect(newTrackProperties(form, DEFAULTS).drone).toEqual({ string: 5, fret: 5 });
    const tenor = applyPreset(newTrackForm('fretted'), 'Tenor banjo CGDA', true);
    expect(tenor.drone).toBeUndefined();
    expect(tenor.program).toBe(105);
  });

  it('keeps the courses the length of the strings: a new string joins the lowest course', () => {
    const seven = setStringCount(twelve(), 7);
    expect(seven.courses).toEqual([0, 0, 12, 12, 12, 12, 12]);
    expect(setStringCount(seven, 5).courses).toEqual([0, 0, 12, 12, 12]);
    const mandolin = applyPreset(newTrackForm('fretted'), 'Mandolin GDAE', true);
    expect(setStringCount(mandolin, 5).courses).toEqual([0, 0, 0, 0, 0]);
    expect(setStringCount(newTrackForm('fretted'), 7).courses).toBeUndefined();
  });

  it('clears the drone on any string count but five', () => {
    const banjo = applyPreset(newTrackForm('fretted'), 'Banjo Open G', true);
    expect(banjo.drone).toEqual({ string: 5, fret: 5 });
    expect(setStringCount(banjo, 4).drone).toBeUndefined();
    expect(setStringCount(banjo, 6).drone).toBeUndefined();
    expect(setStringCount(setStringCount(banjo, 6), 5).drone).toBeUndefined();
    // Cut to 4 strings the form no longer sends a drone the model would refuse.
    const track = createTrack('fretted', {
      tuning: [67, 50, 55, 59, 62],
      drone: { string: 5, fret: 5 },
    });
    expect(trackChanges(track, setStringCount(formFromTrack(track), 4))).toMatchObject({
      tuning: [50, 55, 59, 62],
      drone: null,
    });
  });

  it('summarises the courses for the dialog', () => {
    expect(coursesSummary(twelve().courses)).toBe(
      'Doubled courses: octave on strings 6 to 3, unison on strings 2 and 1',
    );
    expect(coursesSummary([0, 0, 0, 0])).toBe('Doubled courses: unison on strings 4 to 1');
    expect(coursesSummary([null, 12])).toBe('Doubled courses: octave on strings 2');
    expect(coursesSummary(undefined)).toBeUndefined();
    expect(coursesSummary([null, null])).toBeUndefined();
  });
});
