import { chordDiagramPrimitives, chordDiagramSize } from '@reprise/layout';
import type { Track } from '@reprise/model';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useMemo, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { renderPrimitive } from '@/features/score';
import { chordList, type ChordListEntry } from '@/lib/chords';
import { cn } from 'cn';

import { CommandTooltip, HintTooltip } from './command-tooltip';
import { useAppServices } from './services-context';
import { useCommand } from './use-command';

const SPACE = 8;
const PAD = 4;

/** What a chip says to a screen reader: the name, where it is played and where the shape came from. */
export function chipLabel(entry: ChordListEntry): string {
  const places = entry.beats.length === 1 ? '1 place' : `${String(entry.beats.length)} places`;
  const shape = entry.diagram ? (entry.suggested ? ', suggested shape' : ', shape') : ', no shape';
  return `${entry.name}, ${places}${shape}`;
}

function Chip({
  entry,
  box,
  active,
  onPick,
}: {
  entry: ChordListEntry;
  box: { width: number; height: number };
  active: boolean;
  onPick: () => void;
}) {
  const { diagram } = entry;
  const size = diagram ? chordDiagramSize(diagram, SPACE) : { width: 0, height: 0 };
  const role = entry.suggested ? 'muted' : 'ink';
  const primitives = diagram
    ? chordDiagramPrimitives(diagram, {
        x: PAD + box.width - size.width,
        y: PAD,
        space: SPACE,
        role,
      })
    : [];
  const width = box.width + 2 * PAD;
  const height = box.height + 2 * PAD;
  return (
    <li className="shrink-0">
      <button
        type="button"
        aria-pressed={active}
        aria-label={chipLabel(entry)}
        onClick={onPick}
        className={cn(
          'hover:bg-accent focus-visible:ring-ring flex flex-col items-center gap-0.5 rounded-md border px-1 pt-1 outline-none focus-visible:ring-2',
          active && 'border-primary ring-primary ring-2',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'max-w-24 truncate text-xs font-medium',
            entry.suggested && 'text-muted-foreground',
          )}
        >
          {entry.name}
        </span>
        {diagram ? (
          <svg
            aria-hidden="true"
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            className="bg-paper text-ink rounded-sm"
          >
            {primitives.map((primitive, index) => renderPrimitive(primitive, index))}
          </svg>
        ) : (
          <span className="text-muted-foreground pb-1 text-[10px]">No shape</span>
        )}
      </button>
    </li>
  );
}

function currentTrack(
  tracks: readonly Track[] | undefined,
  id: string | undefined,
): Track | undefined {
  return tracks?.find((track) => track.id === id) ?? tracks?.[0];
}

/**
 * The chord strip (#352, F040): the current track's distinct chords in first-use order, each with
 * its shape (the file's, else the engine's first, muted), docked above the score. A click boxes
 * every place that chord is played; the arrows step through them and the score scrolls there,
 * never moving playback. The strip is the `score.chordStrip` setting; this only shows it.
 */
export function ChordStrip() {
  const { ui, document, selection } = useAppServices();
  const tracks = useStore(document, (state) => state.score?.tracks);
  const currentId = useStore(selection, (state) => state.currentTrack);
  const folded = useStore(ui, (state) => state.chordStripFolded);
  const highlight = useStore(ui, (state) => state.chordHighlight);
  const hide = useCommand('view.toggleChordStrip');
  const track = currentTrack(tracks, currentId);
  const entries = useMemo(() => chordList(track), [track]);
  const box = useMemo(() => {
    let width = 0;
    let height = 0;
    for (const { diagram } of entries) {
      if (!diagram) continue;
      const size = chordDiagramSize(diagram, SPACE);
      width = Math.max(width, size.width);
      height = Math.max(height, size.height);
    }
    return { width, height };
  }, [entries]);

  if (!track) return null;
  const picked = highlight?.track === track.id ? highlight : undefined;
  const entry = picked && entries.find((candidate) => candidate.key === picked.key);
  const at = entry ? Math.min(picked.at, entry.beats.length - 1) : 0;

  const pick = (next: ChordListEntry) => {
    ui.getState().setChordHighlight(
      entry?.key === next.key ? undefined : { track: track.id, key: next.key, at: 0 },
    );
  };
  const step = (by: number) => {
    if (!entry) return;
    const count = entry.beats.length;
    ui.getState().setChordHighlight({
      track: track.id,
      key: entry.key,
      at: (((at + by) % count) + count) % count,
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!entry || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      ui.getState().setChordHighlight(undefined);
    }
  };

  return (
    <section
      aria-label="Chord strip"
      className="score-chord-strip bg-card text-card-foreground border-b"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-8 items-center gap-1 px-2">
        <HintTooltip label={folded ? 'Show chords' : 'Fold chords'}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={!folded}
            aria-label={folded ? 'Show chords' : 'Fold chords'}
            onClick={() => {
              ui.getState().setChordStripFolded(!folded);
            }}
          >
            <ChevronDownIcon aria-hidden="true" className={cn(folded && '-rotate-90')} />
          </Button>
        </HintTooltip>
        <h2 className="truncate text-xs font-medium">
          Chords <span className="text-muted-foreground font-normal">· {track.name}</span>
        </h2>
        {entry && (
          <div className="ml-2 flex items-center gap-0.5">
            <HintTooltip label="Previous place">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Previous place"
                onClick={() => {
                  step(-1);
                }}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
            </HintTooltip>
            <span role="status" className="text-muted-foreground text-xs tabular-nums">
              {entry.name}: {at + 1} of {entry.beats.length}
            </span>
            <HintTooltip label="Next place">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Next place"
                onClick={() => {
                  step(1);
                }}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </HintTooltip>
          </div>
        )}
        <div className="ml-auto">
          <CommandTooltip command="view.toggleChordStrip" label="Hide chord strip">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Hide chord strip"
              onClick={() => {
                ui.getState().setChordHighlight(undefined);
                hide.run();
              }}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </CommandTooltip>
        </div>
      </div>
      {!folded &&
        (entries.length === 0 ? (
          <p className="text-muted-foreground px-3 pb-2 text-xs">This track has no chords.</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto px-2 pb-2">
            {entries.map((candidate) => (
              <Chip
                key={candidate.key}
                entry={candidate}
                box={box}
                active={candidate.key === entry?.key}
                onPick={() => {
                  pick(candidate);
                }}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}
