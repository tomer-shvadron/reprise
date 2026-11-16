import { applyCommand, createEmptyScore, setMasterBars, type Id, type Score } from '@reprise/model';

import { planInsertBar, targetOf } from '../bar-edit';
import { edit, formFromScore, masterBarEdits, type MasterBarForm } from '../master-bar-form';

/** The bars the song's seven master bars are numbered by, 1-based. */
export const EXPECTED_BARS = [1, 2, 3, 2, 4, 5, 6, 1, 2, 4, 7];

/** Applies what the master-bar dialog would for bars `from` to `to` (1-based). */
function dialog(
  score: Score,
  from: number,
  to: number,
  change: (form: MasterBarForm) => MasterBarForm,
): Score {
  const ids = score.masterBars.slice(from - 1, to).map(({ id }) => id);
  const target = targetOf(ids);
  const form = target && formFromScore(score, target);
  if (!target || !form) throw new Error('no such bars');
  const edits = masterBarEdits(score, target, change(form));
  return applyCommand(score, setMasterBars(edits)).score;
}

/**
 * The acceptance song, built by the planners the UI runs on a new song: seven 4/4 bars with a
 * segno on 1, a repeat 2 to 3 with two endings, a To Coda on 4, 3/4 on 5 and 6 with a D.S. al
 * Coda on 6, and a coda on 7, at 240 BPM. It plays 1, 2, 3, 2, 4, 5, 6, 1, 2, 4, 7.
 */
export function acceptanceSong(): Score {
  let current = createEmptyScore();
  for (let bar = 1; bar < 7; bar++) {
    const last = current.masterBars.at(-1)?.id as Id;
    const target = targetOf([last]);
    const plan = target && planInsertBar(current, target, 'after');
    if (!plan) throw new Error('no insert');
    current = applyCommand(current, plan.command).score;
  }
  current = dialog(current, 1, 1, (form) =>
    edit(edit(form, 'tempo', { tempo: { on: true, bpm: '240' } }), 'segno', { segno: true }),
  );
  current = dialog(current, 2, 2, (form) => edit(form, 'repeatStart', { repeatStart: true }));
  current = dialog(current, 3, 3, (form) =>
    edit(edit(form, 'repeatEnd', { repeatEnd: { on: true, count: '2' } }), 'endings', {
      endings: [1],
    }),
  );
  current = dialog(current, 4, 4, (form) =>
    edit(edit(form, 'endings', { endings: [2] }), 'jump', { jump: 'toCoda' }),
  );
  current = dialog(current, 5, 6, (form) =>
    edit(
      edit({ ...form, continueSignatures: false }, 'time', {
        time: { numerator: '3', denominator: '4' },
      }),
      'jump',
      { jump: 'dsAlCoda' },
    ),
  );
  return dialog(current, 7, 7, (form) => edit(form, 'coda', { coda: true }));
}
