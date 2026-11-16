import { applyCommand, createEmptyScore, setMasterBars, type Score } from '@reprise/model';
import { note, score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { planInsertBar, targetOf } from './bar-edit';
import {
  edit,
  formFromScore,
  keyLabel,
  masterBarEdits,
  overfullBars,
  validateMasterBarForm,
} from './master-bar-form';
import { must } from './test/must';

function bars(count: number): Score {
  let score = createEmptyScore();
  for (let at = 1; at < count; at++) {
    const target = must(targetOf([must(score.masterBars.at(-1)).id]));
    score = applyCommand(score, must(planInsertBar(score, target, 'after')).command).score;
  }
  return score;
}

function setup(count: number, from: number, to: number) {
  const score = bars(count);
  const target = targetOf(score.masterBars.slice(from - 1, to).map(({ id }) => id));
  const form = target && formFromScore(score, target);
  if (!target || !form) throw new Error('no form');
  return { score, target, form };
}

describe('masterBarEdits', () => {
  it('writes nothing for a form nobody touched', () => {
    const { score, target, form } = setup(3, 1, 3);
    expect(masterBarEdits(score, target, form)).toEqual([]);
  });

  it('puts first-bar fields on the first bar and last-bar fields on the last', () => {
    const { score, target, form } = setup(4, 2, 3);
    let next = edit(form, 'repeatStart', { repeatStart: true });
    next = edit(next, 'section', { section: { name: 'Verse', letter: 'A' } });
    next = edit(next, 'segno', { segno: true });
    next = edit(next, 'repeatEnd', { repeatEnd: { on: true, count: '3' } });
    next = edit(next, 'jump', { jump: 'dalSegno' });
    next = edit(next, 'fine', { fine: true });
    const [first, last, ...rest] = masterBarEdits(score, target, next);
    expect(rest).toEqual([]);
    expect(first).toEqual({
      masterBarId: score.masterBars[1]?.id,
      changes: {
        repeat: { start: true, endCount: 0 },
        section: { name: 'Verse', letter: 'A' },
        targets: ['segno'],
      },
    });
    expect(last).toEqual({
      masterBarId: score.masterBars[2]?.id,
      changes: {
        repeat: { start: false, endCount: 3 },
        jumps: [{ kind: 'dalSegno' }],
        targets: ['fine'],
      },
    });
  });

  it('merges repeat start and end on one bar', () => {
    const { score, target, form } = setup(2, 2, 2);
    const next = edit(edit(form, 'repeatStart', { repeatStart: true }), 'repeatEnd', {
      repeatEnd: { on: true, count: '2' },
    });
    expect(masterBarEdits(score, target, next)[0]?.changes.repeat).toEqual({
      start: true,
      endCount: 2,
    });
  });

  it('puts endings, time and key on every bar of a range', () => {
    const { score, target, form } = setup(4, 1, 2);
    let next = edit(form, 'endings', { endings: [2, 1] });
    next = edit(edit(next, 'key', { key: { fifths: 2, minor: true } }), 'mode', {
      key: { fifths: 2, minor: true },
    });
    const edits = masterBarEdits(score, { ...target }, { ...next, continueSignatures: false });
    expect(edits.map(({ changes }) => changes)).toEqual([
      { alternateEndings: [1, 2], keySignature: { fifths: 2, minor: true } },
      { alternateEndings: [1, 2], keySignature: { fifths: 2, minor: true } },
    ]);
  });

  it('continues a time change until the next bar that already differs', () => {
    const { score, target, form } = setup(5, 2, 2);
    const changed = applyCommand(
      score,
      setMasterBars([
        {
          masterBarId: score.masterBars[3]?.id ?? '',
          changes: { timeSignature: { numerator: 6, denominator: 8 } },
        },
      ]),
    ).score;
    const next = edit(form, 'time', { time: { numerator: '3', denominator: '4' } });
    const on = masterBarEdits(changed, target, next).map(({ masterBarId }) => masterBarId);
    expect(on).toEqual([1, 2].map((index) => changed.masterBars[index]?.id));
    const off = masterBarEdits(changed, target, { ...next, continueSignatures: false });
    expect(off.map(({ masterBarId }) => masterBarId)).toEqual([changed.masterBars[1]?.id]);
  });

  it('removes a section with null and a tempo with null, and keeps the tempo unit and label', () => {
    const { score, target, form } = setup(2, 2, 2);
    const withMarks = applyCommand(
      score,
      setMasterBars([
        {
          masterBarId: target.first,
          changes: {
            tempo: { bpm: 90, unit: 'dottedQuarter', label: 'Slow' },
            section: { name: 'Intro', color: '#ff0000' },
          },
        },
      ]),
    ).score;
    const marked = formFromScore(withMarks, target);
    if (!marked) throw new Error('no form');
    expect(marked.tempo).toEqual({ on: true, bpm: '90' });
    const retimed = edit(marked, 'tempo', { tempo: { on: true, bpm: '100' } });
    expect(masterBarEdits(withMarks, target, retimed)[0]?.changes.tempo).toEqual({
      bpm: 100,
      unit: 'dottedQuarter',
      label: 'Slow',
    });
    const cleared = edit(edit(marked, 'tempo', { tempo: { on: false, bpm: '90' } }), 'section', {
      section: { name: ' ', letter: '' },
    });
    expect(masterBarEdits(withMarks, target, cleared)[0]?.changes).toEqual({
      tempo: null,
      section: null,
    });
    expect(form.tempo.on).toBe(false);
  });

  it('leaves several imported jumps alone', () => {
    const { score, target } = setup(2, 2, 2);
    const several = applyCommand(
      score,
      setMasterBars([
        { masterBarId: target.first, changes: { jumps: [{ kind: 'daCapo' }, { kind: 'toCoda' }] } },
      ]),
    ).score;
    const form = formFromScore(several, target);
    expect(form?.jump).toBe('several');
    const touched = form && edit(form, 'jump', { jump: 'several' });
    expect(touched && masterBarEdits(several, target, touched)).toEqual([]);
  });
});

describe('Mixed fields', () => {
  it('shows a range whose bars differ as mixed and empty', () => {
    const built = bars(3);
    const changed = applyCommand(
      built,
      setMasterBars([
        {
          masterBarId: built.masterBars[1]?.id ?? '',
          changes: { timeSignature: { numerator: 3, denominator: 4 } },
        },
      ]),
    ).score;
    const target = targetOf(changed.masterBars.map(({ id }) => id));
    const form = target && formFromScore(changed, target);
    expect(form?.mixed.time).toBe(true);
    expect(form?.time).toEqual({ numerator: '', denominator: '' });
    expect(form?.mixed.key).toBeUndefined();
  });
});

describe('validation', () => {
  it('checks the ranges of the fields it touched only', () => {
    const { form } = setup(1, 1, 1);
    expect(validateMasterBarForm(form)).toEqual({});
    expect(
      Object.keys(
        validateMasterBarForm(edit(form, 'time', { time: { numerator: '0', denominator: '4' } })),
      ),
    ).toEqual(['numerator']);
    expect(
      Object.keys(validateMasterBarForm(edit(form, 'tempo', { tempo: { on: true, bpm: '5' } }))),
    ).toEqual(['tempo']);
    expect(
      Object.keys(
        validateMasterBarForm(edit(form, 'repeatEnd', { repeatEnd: { on: true, count: '1' } })),
      ),
    ).toEqual(['count']);
  });

  it('names the key a signature stands for', () => {
    expect(keyLabel(1, false)).toBe('G major, 1♯');
    expect(keyLabel(-7, true)).toBe('A♭ minor, 7♭');
    expect(keyLabel(0, false)).toBe('C major, no sharps or flats');
  });

  it('finds the bars a smaller signature would cut, and only those that fitted before', () => {
    const built = scoreBuilder().track('guitar');
    const quarters = (count: number) => {
      for (let beat = 0; beat < count; beat++) built.beat('4', [note(1, beat)]);
    };
    built.bar();
    quarters(4);
    built.bar();
    quarters(5);
    // An over-full bar, as an imported tab may hold.
    const song = built.build({ validate: false });
    const target = must(targetOf(song.masterBars.map(({ id }) => id)));
    const form = must(formFromScore(song, target));
    const time = (numerator: string) =>
      masterBarEdits(
        song,
        target,
        edit({ ...form, continueSignatures: false }, 'time', {
          time: { numerator, denominator: '4' },
        }),
      );
    // 3/4 cuts the four quarters of bar 1; bar 2 held five in a 4/4 bar, so it never fitted.
    expect(overfullBars(song, time('3'))).toEqual([1]);
    // 5/4 and an unchanged 4/4 give every bar the room it had or more.
    expect(overfullBars(song, time('5'))).toEqual([]);
    expect(overfullBars(song, time('4'))).toEqual([]);
  });

  it('writes nothing for a field the player touched and left as it was', () => {
    const { score, target, form } = setup(3, 1, 3);
    const retyped = edit(form, 'time', { time: { numerator: '4', denominator: '4' } });
    const toggled = edit(edit(form, 'segno', { segno: true }), 'segno', { segno: false });
    expect(masterBarEdits(score, target, retyped)).toEqual([]);
    expect(masterBarEdits(score, target, toggled)).toEqual([]);
  });

  it('keeps each bar its own key when only the mode of mixed keys changes', () => {
    const built = setup(2, 1, 2);
    const keyed = applyCommand(
      built.score,
      setMasterBars([
        {
          masterBarId: must(built.score.masterBars[1]).id,
          changes: { keySignature: { fifths: 3, minor: false } },
        },
      ]),
    ).score;
    const form = must(formFromScore(keyed, built.target));
    expect(form.mixed).toEqual({ key: true });
    const minor = edit(form, 'mode', { key: { ...form.key, minor: true } });
    expect(
      masterBarEdits(keyed, built.target, { ...minor, continueSignatures: false }).map(
        ({ changes }) => changes.keySignature,
      ),
    ).toEqual([
      { fifths: 0, minor: true },
      { fifths: 3, minor: true },
    ]);
  });
});
