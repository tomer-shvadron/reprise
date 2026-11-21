import { scaleName, scaleOf, type SongInsights } from '@/lib/insights';
import { spellPitchClass } from '@/lib/chords';

import { CommandTooltip } from '@/app/command-tooltip';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';

import { InsightCard } from './card';

export function ScaleCard({ songKey }: { songKey: SongInsights['key'] }) {
  const show = useCommand('trainer.fretboardSongScale');
  if (!songKey.found || !songKey.scale) return null;
  const fit = songKey.scale;
  const fileKey = songKey.fileKeySignature;
  return (
    <InsightCard title="Scale" data-insight-card="scale">
      <p className="text-sm font-medium" data-insight-scale>
        {songKey.scaleName}
      </p>
      <p className="text-muted-foreground text-xs">
        Covers {String(Math.round(fit.coverage * 100))}% of the notes.
      </p>
      {fit.mixedThirds && (
        <p className="text-muted-foreground text-xs">Mixes major and minor thirds (blues).</p>
      )}
      {fit.alsoFits.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Also fits{' '}
          {fit.alsoFits
            .slice(0, 3)
            .map((other) => scaleName(songKey.tonic, other.scale, fileKey))
            .join(', ')}
          .
        </p>
      )}
      {fit.outside.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Outside the scale:{' '}
          {fit.outside
            .slice(0, 4)
            .map(
              (note) =>
                `${spellPitchClass(note.pitchClass, songKey.signature, true)} (${String(Math.round(note.share * 100))}%)`,
            )
            .join(', ')}
          .
        </p>
      )}
      <p className="sr-only">{scaleOf(fit.scale).degrees.join(' ')}</p>
      <CommandTooltip command="trainer.fretboardSongScale" label="Show on fretboard">
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => {
            show.run();
          }}
        >
          Show on fretboard
        </Button>
      </CommandTooltip>
    </InsightCard>
  );
}
