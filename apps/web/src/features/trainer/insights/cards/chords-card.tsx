import { useStore } from 'zustand';

import { CommandTooltip, HintTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import type { ChordsInsight } from '@/lib/insights';

import { arpeggioOverlayFor } from '../../fretboard/arpeggio-overlay';

import { InsightCard } from './card';

const shareText = (share: number): string =>
  share > 0 && share < 0.01 ? 'under 1%' : `${String(Math.round(share * 100))}%`;

/**
 * The chords the song uses, as standard names with how often each comes in, then its progressions.
 * A chip opens the Chords sub-tab on that chord.
 */
export function ChordsCard({ chords }: { chords: ChordsInsight }) {
  const services = useAppServices();
  const on = useStore(arpeggioOverlayFor(services), (state) => state.on);
  const toggle = useCommand('trainer.fretboardArpeggio');
  if (chords.source === 'none' || chords.chords.length === 0) return null;
  return (
    <InsightCard title="Chords" data-insight-card="chords">
      <p className="text-muted-foreground text-xs">Times each chord comes in</p>
      <ul className="flex flex-wrap gap-1" aria-label="Chords used">
        {chords.chords.map((chord) => {
          const hint = `Comes in ${String(chord.count)} ${chord.count === 1 ? 'time' : 'times'}, ${shareText(chord.share)} of the time. Click for shapes.`;
          return (
            <li key={chord.name}>
              <HintTooltip label={hint}>
                <Button
                  variant="outline"
                  size="xs"
                  aria-label={`${chord.name}. ${hint}`}
                  onClick={() => {
                    services.ui.getState().setChordsName(chord.name);
                    services.ui.getState().showPanelView('chords');
                  }}
                >
                  {chord.name}
                  <span className="text-muted-foreground text-[10px]">×{String(chord.count)}</span>
                </Button>
              </HintTooltip>
            </li>
          );
        })}
      </ul>
      <CommandTooltip command="trainer.fretboardArpeggio" label="Show on fretboard">
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          aria-pressed={on}
          onClick={() => {
            toggle.run();
          }}
        >
          Show chord tones on fretboard
        </Button>
      </CommandTooltip>
      {chords.source === 'inferred' && (
        <p className="text-muted-foreground text-xs" data-insight-inferred>
          Inferred from the notes.
        </p>
      )}
      {chords.progressions.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs" aria-label="Progressions">
          {chords.progressions.map((progression, index) => (
            <li key={`${progression.section ?? ''}-${String(index)}`}>
              {progression.section && (
                <span className="text-muted-foreground">{progression.section}: </span>
              )}
              <span className="font-medium">{progression.label}</span>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}
