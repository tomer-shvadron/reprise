import type { Id, Score } from '@reprise/model';

import type { AppServices } from '@/app/services';

import { clipSummary, copyClip, planCut } from './clip';
import { clipboardOf } from './clipboard-store';
import type { Clip } from './clipboard-format';
import { commitEdit } from './commit';
import { planPaste, type PasteMode } from './paste';
import { rangePatch } from './range';
import { visibleTracks } from './visible';

export type ClipboardServices = Pick<AppServices, 'document' | 'selection' | 'entry' | 'editing'>;

/** The score and visible tracks an edit acts on now; undefined outside edit mode or without a score. */
function context(services: ClipboardServices): { score: Score; visible: Id[] } | undefined {
  const { score, view } = services.document.getState();
  if (!score || !services.editing.getState().editing) return undefined;
  return { score, visible: visibleTracks(score, view) };
}

const notice = (services: ClipboardServices, text: string) => {
  services.entry.getState().setMessage(text, 'notice');
};

/**
 * Copies the selection (the beat under the cursor without one) onto the internal clipboard and
 * returns the clip, for the caller to put on the system clipboard too. A refusal goes to the
 * status line.
 */
export function copySelection(services: ClipboardServices): Clip | undefined {
  const here = context(services);
  if (!here) return undefined;
  const result = copyClip(here.score, services.selection.getState(), here.visible);
  if ('refused' in result) {
    services.entry.getState().setMessage(result.refused);
    return undefined;
  }
  clipboardOf(services).set(result.clip);
  notice(services, `Copied ${clipSummary(result.clip)}`);
  return result.clip;
}

/** Copies, then removes the copied beats as one undo step; the bars stay. Returns the clip, or undefined on a refusal. */
export function cutSelection(services: ClipboardServices): Clip | undefined {
  const here = context(services);
  if (!here) return undefined;
  const state = services.selection.getState();
  const copied = copyClip(here.score, state, here.visible);
  const cut = planCut(here.score, state, here.visible);
  if ('refused' in copied || 'refused' in cut) {
    services.entry
      .getState()
      .setMessage(
        'refused' in cut ? cut.refused : 'refused' in copied ? copied.refused : undefined,
      );
    return undefined;
  }
  if (!commitEdit(services, cut.command, { moveCursor: false })) return undefined;
  clipboardOf(services).set(copied.clip);
  const next = services.document.getState().score;
  if (next) services.selection.getState().setEdit(rangePatch(next, undefined));
  notice(services, `Cut ${clipSummary(copied.clip)}`);
  return copied.clip;
}

/**
 * Pastes `clip` at the cursor (or the range's start) as one undo step: insert or overwrite as
 * `mode` says. The cursor lands on the first pasted beat or bar and the pasted span is selected.
 */
export function pasteClip(services: ClipboardServices, clip: Clip, mode: PasteMode): boolean {
  const here = context(services);
  if (!here) return false;
  const plan = planPaste(here.score, clip, services.selection.getState(), here.visible, mode);
  if ('refused' in plan) {
    services.entry.getState().setMessage(plan.refused);
    return false;
  }
  if (!commitEdit(services, plan.command, { land: plan.land })) return false;
  const next = services.document.getState().score;
  if (next) services.selection.getState().setEdit(rangePatch(next, plan.range));
  notice(services, plan.notice);
  return true;
}

/** Pastes the internal clipboard, the palette's Paste; `mode` defaults to the session's insert or overwrite. */
export function pasteInternal(services: ClipboardServices, mode?: PasteMode): boolean {
  const clip = clipboardOf(services).get();
  if (!clip) {
    services.entry.getState().setMessage('The clipboard is empty: copy some notes first');
    return false;
  }
  return pasteClip(services, clip, mode ?? services.entry.getState().mode);
}
