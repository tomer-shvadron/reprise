import { CommandError, setMasterBars, type Id, type Score } from '@reprise/model';

import type { AppServices } from '@/app/services';

import {
  barTarget,
  deleteBlocker,
  planDeleteBars,
  planInsertBar,
  planToggleRepeatEnd,
  planToggleRepeatStart,
  targetOf,
  type BarTarget,
} from './bar-edit';
import { commitEdit } from './commit';
import { dialogsOf, type MasterBarSection } from './dialogs';
import {
  formFromScore,
  masterBarEdits,
  overfullBars,
  overfullMessage,
  targetTitle,
  type MasterBarForm,
} from './master-bar-form';
import { describeRefusal } from './refusal';
import { rangePatch } from './range';
import { newStructureWarnings } from './structure-warnings';

export type BarServices = Pick<AppServices, 'document' | 'selection' | 'entry' | 'editing'>;

/** The bars a command acts on now, or undefined outside edit mode, without a score or a cursor. */
export function currentTarget(services: BarServices): BarTarget | undefined {
  const { score } = services.document.getState();
  if (!score || !services.editing.getState().editing) return undefined;
  return barTarget(score, services.selection.getState());
}

/**
 * Says on the status line what an edit made of the song's structure that playback will ignore or
 * work around, a jump without its target for one. Non-blocking: the edit stands. The latest edit
 * owns the line, so a clean one clears it.
 */
function reportStructure(services: BarServices, before: Score): void {
  const after = services.document.getState().score;
  const [warning] = after ? newStructureWarnings(before, after) : [];
  services.entry.getState().setMessage(warning);
}

/** Inserts a bar before the target's first bar or after its last, and puts the cursor in it. */
export function insertBarAt(services: BarServices, where: 'before' | 'after'): void {
  const { score } = services.document.getState();
  const target = currentTarget(services);
  const plan = score && target && planInsertBar(score, target, where);
  if (!plan) return;
  if (commitEdit(services, plan.command, { land: { bar: plan.bar } })) {
    const next = services.document.getState().score;
    if (next) services.selection.getState().setEdit(rangePatch(next, undefined));
  }
}

/** Deletes the target's bars as one step; refusing every bar says why on the status line. */
export function deleteTargetBars(services: BarServices): void {
  const { score } = services.document.getState();
  const target = currentTarget(services);
  if (!score || !target) return;
  const blocker = deleteBlocker(score, target);
  if (blocker !== undefined) {
    services.entry.getState().setMessage(blocker);
    return;
  }
  const command = planDeleteBars(score, target);
  if (command && commitEdit(services, command, { moveCursor: false }))
    reportStructure(services, score);
}

function toggleRepeat(
  services: BarServices,
  plan: typeof planToggleRepeatStart | typeof planToggleRepeatEnd,
): void {
  const { score } = services.document.getState();
  const target = currentTarget(services);
  const command = score && target && plan(score, target);
  if (command && commitEdit(services, command, { moveCursor: false })) {
    reportStructure(services, score);
  }
}

export const toggleRepeatStart = (services: BarServices) => {
  toggleRepeat(services, planToggleRepeatStart);
};
export const toggleRepeatEnd = (services: BarServices) => {
  toggleRepeat(services, planToggleRepeatEnd);
};

/** Opens the master-bar dialog on the current target, snapshotting its bars. */
export function openMasterBarDialog(services: BarServices, focus?: MasterBarSection): void {
  const target = currentTarget(services);
  if (!target) return;
  dialogsOf(services)
    .getState()
    .open({ kind: 'masterBar', ids: target.ids, ...(focus && { focus }) });
}

/** The dialog section a refusal belongs to, so focus can go to its first field. */
export type RefusedSection = Extract<MasterBarSection, 'time' | 'tempo' | 'repeats'>;

export type ApplyResult = { ok: true } | { ok: false; message: string; section?: RefusedSection };

function sectionOf(error: CommandError): RefusedSection | undefined {
  if (error.code === 'voice-overfull') return 'time';
  const [violation] = error.violations;
  switch (violation?.rule) {
    case 'alternate-ending-outside-repeat':
    case 'alternate-ending-order':
      return 'repeats';
    case 'first-bar-tempo':
      return 'tempo';
    default:
      return undefined;
  }
}

/**
 * Applies the dialog's form as one history step. Only fields that changed are written; a refusal
 * (notes that no longer fit, a volta without its repeat end) leaves the score alone and comes
 * back as the sentence the dialog shows, with the section it belongs to.
 */
export function applyMasterBarForm(
  services: BarServices,
  ids: readonly Id[],
  form: MasterBarForm,
): ApplyResult {
  const { document } = services;
  const { score } = document.getState();
  const target = targetOf(ids);
  if (!score || !target) return { ok: false, message: 'Those bars are gone' };
  const edits = masterBarEdits(score, target, form);
  if (edits.length === 0) return { ok: true };
  const overfull = overfullBars(score, edits);
  if (overfull.length > 0) {
    return { ok: false, message: overfullMessage(score, edits, overfull), section: 'time' };
  }
  try {
    document.getState().apply(setMasterBars(edits));
  } catch (error) {
    const message = describeRefusal(error);
    if (message === undefined) throw error;
    const section = error instanceof CommandError ? sectionOf(error) : undefined;
    return { ok: false, message, ...(section && { section }) };
  }
  reportStructure(services, score);
  return { ok: true };
}

/** The dialog's own view of its target: title and form, from the bars it snapshotted. */
export function dialogTarget(services: Pick<BarServices, 'document'>, ids: readonly Id[]) {
  const { score } = services.document.getState();
  const target = targetOf(ids);
  if (!score || !target) return undefined;
  const form = formFromScore(score, target);
  return form && { score, target, form, title: targetTitle(score, target) };
}
