import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { loopBarNumbers } from '@/features/transport';

import { barsText, formatDuration, tempoText } from './format';
import { practiceLogFor } from './install';
import { resumePractice } from './resume';
import type { PracticeSessionRow } from './row';
import { resumeTarget, songSummary } from './summary';

export interface SongPracticePageProps {
  song: { id: string; title: string; artist: string };
  /** Opens the song in the player; Resume calls it unless the song is already open. */
  open: () => Promise<void>;
  onBack: () => void;
}

/** The newest sessions listed at first; the total and the loops summarise all of them. */
const SESSION_LIMIT = 50;

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The practice log of one song: total time, sessions, loops with their best tempos, and Resume. */
export function SongPracticePage({ song, open, onBack }: SongPracticePageProps) {
  const services = useAppServices();
  const heading = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<PracticeSessionRow[] | undefined>();
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const openScore = useStore(services.document, (state) =>
    state.songId === song.id ? state.score : undefined,
  );

  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    let current = true;
    const read = practiceLogFor(services)?.forSong(song.id) ?? Promise.resolve([]);
    void read.then((found) => {
      if (current) setRows(found);
    });
    return () => {
      current = false;
    };
  }, [services, song.id]);

  const summary = useMemo(() => songSummary(rows ?? []), [rows]);
  const target = useMemo(() => resumeTarget(rows ?? []), [rows]);

  // Live while the song is open, so the labels follow edits; stored otherwise.
  const labelOf = (loop: {
    startBar: string;
    endBar: string;
    label?: { start: number; end: number } | undefined;
  }) => (openScore ? loopBarNumbers(openScore, loop) : loop.label);

  const resumeLabel = (() => {
    if (!target) return 'Resume';
    const bars = target.loop
      ? labelOf({ ...target.loop, label: latestLabel(rows, target.loop) })
      : undefined;
    // Only a loop that cannot be found in the open song is called removed; a closed song with no
    // stored label says nothing about its bars.
    const removed = target.loop && openScore && !bars;
    return [
      'Resume',
      bars ? barsText(bars) : '',
      target.tempo ? `at ${tempoText(target.tempo)}` : '',
      removed ? '(loop’s bars removed)' : '',
    ]
      .filter(Boolean)
      .join(' ');
  })();

  const shown = showAll ? summary.sessions : summary.sessions.slice(0, SESSION_LIMIT);

  return (
    <section
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto outline-none"
      aria-label="Practice log"
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="truncate text-lg font-semibold outline-none">
            {song.title}
          </h2>
          <p className="text-muted-foreground truncate text-sm">{song.artist}</p>
        </div>
        <Button
          className="ml-auto"
          disabled={!target}
          onClick={() => {
            if (!target) return;
            setError(undefined);
            resumePractice(services, song.id, target, open).catch((failure: unknown) => {
              setError(failure instanceof Error ? failure.message : 'Could not resume');
            });
          }}
        >
          {resumeLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not resume: {error}
        </p>
      )}
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing practised yet. Play this song and your sessions appear here.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Total practice time: <strong>{formatDuration(summary.totalPlayedMs)}</strong> over{' '}
            {summary.sessions.length} {summary.sessions.length === 1 ? 'session' : 'sessions'}
          </p>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Loops worked on</h3>
            {summary.loops.length === 0 ? (
              <p className="text-muted-foreground text-sm">No loops yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {summary.loops.map((loop) => (
                  <li key={`${loop.startBar}:${loop.endBar}`} className="flex gap-3">
                    <span className="min-w-28 font-medium">{barsText(labelOf(loop))}</span>
                    <span className="text-muted-foreground">
                      {loop.bestPercent === undefined
                        ? 'No full step completed'
                        : `Best ${String(Math.round(loop.bestPercent))}%${loop.bestBpm === undefined ? '' : ` (${String(loop.bestBpm)} BPM)`}`}
                    </span>
                    <span className="text-muted-foreground ml-auto">
                      {dateTime.format(loop.lastPracticedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Sessions</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {shown.map((session) => (
                <li key={session.id} className="flex gap-3">
                  <span className="min-w-44">{dateTime.format(session.startedAt)}</span>
                  <span className="min-w-20">{formatDuration(session.playedMs)}</span>
                  <span className="text-muted-foreground truncate">
                    {session.loops.map((loop) => barsText(labelOf(loop))).join(', ')}
                  </span>
                  <span className="text-muted-foreground ml-auto">{bestStep(session)}</span>
                </li>
              ))}
            </ul>
            {!showAll && summary.sessions.length > SESSION_LIMIT && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => {
                  setShowAll(true);
                }}
              >
                Show all {summary.sessions.length} sessions
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function bestStep(session: PracticeSessionRow): string {
  const best = Math.max(0, ...session.loops.map((loop) => loop.bestPercent ?? 0));
  return best > 0 ? `Best step ${String(Math.round(best))}%` : '';
}

/** The stored label of a loop, from the newest session that has one. */
function latestLabel(
  rows: readonly PracticeSessionRow[] | undefined,
  range: { startBar: string; endBar: string },
) {
  const newestFirst = [...(rows ?? [])].sort((a, b) => b.startedAt - a.startedAt);
  for (const row of newestFirst) {
    const found = row.loops.find(
      (loop) => loop.startBar === range.startBar && loop.endBar === range.endBar,
    );
    if (found?.label) return found.label;
  }
  return undefined;
}
