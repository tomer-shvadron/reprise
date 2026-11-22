import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import type { ChordsInsight } from '@/lib/insights';

import { InsightCard } from './card';

/**
 * The chords the song uses, as standard names with their counts, then its progressions. A chip
 * opens the Chords sub-tab on that chord.
 */
export function ChordsCard({ chords }: { chords: ChordsInsight }) {
  const services = useAppServices();
  if (chords.source === 'none' || chords.chords.length === 0) return null;
  return (
    <InsightCard title="Chords" data-insight-card="chords">
      <ul className="flex flex-wrap gap-1" aria-label="Chords used">
        {chords.chords.map((chord) => (
          <li key={chord.name}>
            <Button
              variant="outline"
              size="xs"
              aria-label={`${chord.name}, ${String(chord.count)} ${chord.count === 1 ? 'time' : 'times'}. Show shapes`}
              onClick={() => {
                services.ui.getState().setChordsName(chord.name);
                services.ui.getState().showPanelView('chords');
              }}
            >
              {chord.name}
              <span className="text-muted-foreground ml-1 text-[10px]">{String(chord.count)}</span>
            </Button>
          </li>
        ))}
      </ul>
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
