import type { KeySignature } from '@reprise/model';

import { keyName, type Confidence, type FoundKey, type SongInsights } from '@/lib/insights';

import { InsightCard } from './card';
import { PitchHistogram } from './histogram';

const CONFIDENCE: Record<Confidence, string> = {
  high: 'Likely',
  medium: 'Possibly',
  low: 'Unclear',
};

/** The key a signature names: C major for no accidentals, in the file's own spelling. */
function signatureName({ fifths, minor }: KeySignature): string {
  const major = (((fifths * 7) % 12) + 12) % 12;
  return keyName(minor ? (major + 9) % 12 : major, minor ? 'minor' : 'major', { fifths, minor });
}

/** How the next best key relates to the winner, when it is the relative key. */
function relationOf(found: FoundKey): string {
  const { tonic, quality, runnerUp } = found;
  if (quality === 'minor' && runnerUp.quality === 'major' && runnerUp.tonic === (tonic + 3) % 12)
    return ' (relative major)';
  if (quality === 'major' && runnerUp.quality === 'minor' && runnerUp.tonic === (tonic + 9) % 12)
    return ' (relative minor)';
  if (runnerUp.tonic === tonic && quality !== 'none') {
    return quality === 'minor' ? ' (parallel major)' : ' (parallel minor)';
  }
  return '';
}

export function KeyCard({ songKey }: { songKey: SongInsights['key'] }) {
  if (!songKey.found) {
    return (
      <InsightCard title="Key" data-insight-card="key">
        <p className="text-sm">Not enough notes to find a key.</p>
      </InsightCard>
    );
  }
  const quality = songKey.quality;
  return (
    <InsightCard title="Key" data-insight-card="key">
      <p className="text-lg leading-tight font-semibold" data-insight-key>
        {songKey.name}
      </p>
      <p className="text-muted-foreground text-xs">
        {CONFIDENCE[songKey.confidence]}
        {quality === 'none' ? ', neither major nor minor (no third)' : ''}
        {`. Next best: ${songKey.runnerUpName}${relationOf(songKey)}`}
      </p>
      {songKey.fileKeySignature && songKey.agreesWithFile === false && (
        <p className="text-muted-foreground text-xs">
          The file&apos;s key signature says {signatureName(songKey.fileKeySignature)}.
        </p>
      )}
      <PitchHistogram found={songKey} />
    </InsightCard>
  );
}
