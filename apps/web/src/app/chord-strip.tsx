import { chordDiagramPrimitives, chordDiagramSize } from '@reprise/layout';
import type { Track } from '@reprise/model';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { memo, useMemo, type KeyboardEvent } from 'react';
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

/** Past this fret a shape is not in open position, so its chip says where it is. */
const OPEN_POSITION_LAST_FRET = 3;

/** The lowest fretted fret of a shape (not `baseFret`, which a file may leave at 1); 0 when all open or muted. */
function lowestFret(entry: ChordListEntry): number {
  const frets = entry.diagram?.frets.filter((fret): fret is number => fret !== null && fret > 0);
  return frets && frets.length > 0 ? Math.min(...frets) : 0;
}

interface ChipPosition {
  /** "3fr" or "open": under the name. */
  short: string;
  /** "at fret 3" or "open position": for a screen reader. */
  spoken: string;
}

/**
 * Where a shape sits, when that tells two chips of one name apart or the shape is up the neck;
 * undefined for a name that appears once in open position, which needs no label.
 */
function positionOf(entry: ChordListEntry, repeated: boolean): ChipPosition | undefined {
  if (!entry.diagram) return undefined;
  const fret = lowestFret(entry);
  if (!repeated && fret <= OPEN_POSITION_LAST_FRET) return undefined;
  return fret <= 1
    ? { short: 'open', spoken: 'open position' }
    : { short: `${String(fret)}fr`, spoken: `at fret ${String(fret)}` };
}

/** What a chip says to a screen reader: the name, its position, where it is played and where the shape came from. */
export function chipLabel(entry: ChordListEntry, position?: ChipPosition): string {
  const places = entry.beats.length === 1 ? '1 place' : `${String(entry.beats.length)} places`;
  const shape = entry.diagram ? (entry.suggested ? ', suggested shape' : ', shape') : ', no shape';
  return `${entry.name}${position ? ` ${position.spoken}` : ''}, ${places}${shape}`;
}

function Chip({
  entry,
  box,
  active,
  position,
  onPick,
}: {
  entry: ChordListEntry;
  position: ChipPosition | undefined;
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
        aria-label={chipLabel(entry, position)}
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
          {position && (
            <span className="text-muted-foreground font-normal"> · {position.short}</span>
          )}
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
export const ChordStrip = memo(function ChordStrip() {
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
  const repeated = new Set(
    entries
      .filter((a, i) => entries.some((b, j) => j !== i && b.name === a.name))
      .map((e) => e.name),
  );
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
        <div className="ml-2 flex items-center gap-0.5">
          {entry && (
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
          )}
          {/* Always mounted, so the first pick is announced as a change to a live region. */}
          <span role="status" className="text-muted-foreground text-xs tabular-nums">
            {entry ? `${entry.name}: ${String(at + 1)} of ${String(entry.beats.length)}` : ''}
          </span>
          {entry && (
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
          )}
        </div>
        <div className="ml-auto">
          <CommandTooltip command="view.toggleChordStrip" label="Hide chord strip">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Hide chord strip"
              onClick={() => {
                hide.run();
                // The button unmounts with the strip; focus goes back to the score, not to body.
                window.document.querySelector<HTMLElement>('[aria-label^="Score: "]')?.focus();
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
                position={positionOf(candidate, repeated.has(candidate.name))}
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
});
