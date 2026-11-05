import type { DirectionTarget, JumpKind, MasterBar } from './master-bar';
import type { Score } from './score';

/** One play of a master bar; `passIndex` counts the earlier plays of the same bar, from 0. */
export interface BarPass {
  masterBarIndex: number;
  passIndex: number;
}

export type PlaybackWarningCode =
  | 'repeat-end-without-start'
  | 'volta-without-repeat'
  | 'jump-target-missing'
  | 'sequence-truncated';

export interface PlaybackWarning {
  code: PlaybackWarningCode;
  masterBarIndex: number;
  message: string;
}

export interface PlaybackSequence {
  sequence: BarPass[];
  warnings: PlaybackWarning[];
}

/** The sequence never exceeds this many passes per master bar; a backstop for malformed files. */
export const PLAYBACK_LENGTH_FACTOR = 64;

type Mode = 'normal' | 'toEnd' | 'alCoda' | 'alDoubleCoda' | 'alFine';

type JumpRule =
  | { type: 'return'; to: 'capo' | 'segno' | 'segnoSegno'; then: Exclude<Mode, 'normal'> }
  | { type: 'forward'; to: 'coda' | 'doubleCoda'; during: 'alCoda' | 'alDoubleCoda' };

const JUMP_RULES: Record<JumpKind, JumpRule> = {
  daCapo: { type: 'return', to: 'capo', then: 'toEnd' },
  dcAlCoda: { type: 'return', to: 'capo', then: 'alCoda' },
  dcAlDoubleCoda: { type: 'return', to: 'capo', then: 'alDoubleCoda' },
  dcAlFine: { type: 'return', to: 'capo', then: 'alFine' },
  dalSegno: { type: 'return', to: 'segno', then: 'toEnd' },
  dsAlCoda: { type: 'return', to: 'segno', then: 'alCoda' },
  dsAlDoubleCoda: { type: 'return', to: 'segno', then: 'alDoubleCoda' },
  dsAlFine: { type: 'return', to: 'segno', then: 'alFine' },
  dalSegnoSegno: { type: 'return', to: 'segnoSegno', then: 'toEnd' },
  dssAlCoda: { type: 'return', to: 'segnoSegno', then: 'alCoda' },
  dssAlDoubleCoda: { type: 'return', to: 'segnoSegno', then: 'alDoubleCoda' },
  dssAlFine: { type: 'return', to: 'segnoSegno', then: 'alFine' },
  toCoda: { type: 'forward', to: 'coda', during: 'alCoda' },
  toDoubleCoda: { type: 'forward', to: 'doubleCoda', during: 'alDoubleCoda' },
};

/**
 * The volta each bar plays on once a D.C. or D.S. has been taken: the highest number in its run
 * of consecutive volta bars, a repeat start beginning a new run.
 */
function finalEndings(masterBars: readonly MasterBar[]): number[] {
  const finals = masterBars.map(() => 0);
  let runStart = 0;
  for (let i = 0; i <= masterBars.length; i++) {
    const bar = masterBars[i];
    const inRun = bar !== undefined && bar.alternateEndings.length > 0;
    const breaksRun = !inRun || (bar.repeat.start && i > runStart);
    if (breaksRun) {
      const final = Math.max(
        0,
        ...masterBars.slice(runStart, i).flatMap((b) => b.alternateEndings),
      );
      for (let k = runStart; k < i; k++) finals[k] = final;
      runStart = inRun ? i : i + 1;
    }
  }
  return finals;
}

/** The repeat end closing each bar's section: the next bar with a count, before a repeat start. */
function closingEnds(masterBars: readonly MasterBar[]): (number | undefined)[] {
  const ends: (number | undefined)[] = masterBars.map(() => undefined);
  let end: number | undefined;
  for (let i = masterBars.length - 1; i >= 0; i--) {
    const bar = masterBars[i];
    if (bar && bar.repeat.endCount >= 2) end = i;
    ends[i] = end;
    if (bar?.repeat.start) end = undefined;
  }
  return ends;
}

function findTarget(
  masterBars: readonly MasterBar[],
  target: DirectionTarget,
  from: number,
  direction: 'backwardFirst' | 'forwardFirst',
): number | undefined {
  const has = (i: number): boolean => masterBars[i]?.targets.includes(target) ?? false;
  const backward = (start: number): number | undefined => {
    for (let i = start; i >= 0; i--) if (has(i)) return i;
    return undefined;
  };
  const forward = (start: number): number | undefined => {
    for (let i = start; i < masterBars.length; i++) if (has(i)) return i;
    return undefined;
  };
  return direction === 'backwardFirst'
    ? (backward(from) ?? forward(from + 1))
    : (forward(from + 1) ?? backward(from - 1));
}

/**
 * Expands repeats, alternate endings and jumps into the order bars are played in. The semantics,
 * including how malformed files are handled, are documented in this package's README.
 */
export function expandPlaybackSequence(score: Pick<Score, 'masterBars'>): PlaybackSequence {
  const { masterBars } = score;
  const sequence: BarPass[] = [];
  const warnings: PlaybackWarning[] = [];
  const warned = new Set<string>();
  const warn = (code: PlaybackWarningCode, masterBarIndex: number, message: string): void => {
    const key = `${code}:${String(masterBarIndex)}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({ code, masterBarIndex, message });
  };

  const finals = finalEndings(masterBars);
  const closings = closingEnds(masterBars);
  const plays = masterBars.map(() => 0);
  const limit = masterBars.length * PLAYBACK_LENGTH_FACTOR;
  const fired = new Set<string>();
  const repeatPlays = new Map<number, number>();
  let mode: Mode = 'normal';
  let segmentStart = 0;
  let sectionStart: number | undefined;
  let sectionPass = 1;

  const resetRepeats = (): void => {
    repeatPlays.clear();
    sectionStart = undefined;
    sectionPass = 1;
  };

  let i = 0;
  while (i < masterBars.length) {
    const bar = masterBars[i];
    if (!bar) break;
    if (sequence.length >= limit) {
      warn('sequence-truncated', i, `playback stopped after ${String(limit)} bar passes`);
      break;
    }

    if (mode === 'normal' && bar.repeat.start && i !== sectionStart) {
      sectionStart = i;
      sectionPass = 1;
      repeatPlays.clear();
    }
    // A volta bar with no repeat end ahead in its section plays: there is no pass to count.
    let skipped = false;
    if (bar.alternateEndings.length > 0) {
      if (mode !== 'normal') skipped = !bar.alternateEndings.includes(finals[i] ?? 0);
      else if (closings[i] !== undefined) skipped = !bar.alternateEndings.includes(sectionPass);
      else if (sectionStart === undefined && sectionPass === 1) {
        warn(
          'volta-without-repeat',
          i,
          `bar ${String(i + 1)} has an alternate ending but no repeat; played every time`,
        );
      }
    }

    if (!skipped) {
      sequence.push({ masterBarIndex: i, passIndex: plays[i] ?? 0 });
      plays[i] = (plays[i] ?? 0) + 1;
      if (mode === 'alFine' && bar.targets.includes('fine')) break;
    }

    // The repeat sign closes the section whichever ending it sits in, so a skipped bar's is read.
    if (mode === 'normal' && bar.repeat.endCount >= 2) {
      const played = repeatPlays.get(i) ?? 1;
      if (played < bar.repeat.endCount) {
        for (const end of repeatPlays.keys()) if (end < i) repeatPlays.delete(end);
        repeatPlays.set(i, played + 1);
        sectionPass = played + 1;
        if (sectionStart === undefined) {
          warn(
            'repeat-end-without-start',
            i,
            `repeat end at bar ${String(i + 1)} has no repeat start; repeating from bar ${String(segmentStart + 1)}`,
          );
        }
        i = sectionStart ?? segmentStart;
        continue;
      }
    }

    if (skipped) {
      i++;
      continue;
    }

    let next = i + 1;
    for (const [j, jump] of bar.jumps.entries()) {
      const key = `${String(i)}:${String(j)}`;
      const rule = JUMP_RULES[jump.kind];
      if (fired.has(key) || mode !== (rule.type === 'return' ? 'normal' : rule.during)) continue;
      const target =
        rule.type === 'forward'
          ? findTarget(masterBars, rule.to, i, 'forwardFirst')
          : rule.to === 'capo'
            ? 0
            : findTarget(masterBars, rule.to, i, 'backwardFirst');
      if (target === undefined) {
        warn(
          'jump-target-missing',
          i,
          `${jump.kind} at bar ${String(i + 1)} has no ${rule.to}; ignored`,
        );
        continue;
      }
      if (
        rule.type === 'return' &&
        rule.then === 'alFine' &&
        !masterBars.some((b) => b.targets.includes('fine'))
      ) {
        warn(
          'jump-target-missing',
          i,
          `${jump.kind} at bar ${String(i + 1)} has no fine; playing to the end`,
        );
      }
      fired.add(key);
      resetRepeats();
      if (rule.type === 'return') {
        mode = rule.then;
      } else {
        mode = 'normal';
        segmentStart = target;
      }
      next = target;
      break;
    }
    i = next;
  }

  return { sequence, warnings };
}
