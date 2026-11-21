import { scaleOf, scalePitchClasses, type FoundKey } from '@/lib/insights';
import { spellPitchClass } from '@/lib/chords';

const W = 12;
const GAP = 3;
const H = 44;
const LABEL = 12;
const TOP = 5;

/** The share of each pitch class as twelve bars: scale tones filled, the others muted. */
export function pitchHistogramLabel(key: FoundKey): string {
  const total = key.histogram.reduce((sum, value) => sum + value, 0) || 1;
  return `Most used notes: ${key.histogram
    .map((value, pitchClass) => ({ pitchClass, share: value / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 5)
    .map(
      ({ pitchClass, share }) =>
        `${spellPitchClass(pitchClass, key.signature, true)} ${String(Math.round(share * 100))}%`,
    )
    .join(', ')}`;
}

export function PitchHistogram({ found }: { found: FoundKey }) {
  const { histogram, signature } = found;
  const peak = Math.max(...histogram, Number.EPSILON);
  const inScale = new Set(
    found.scale
      ? scalePitchClasses(scaleOf(found.scale.scale), found.tonic)
      : scalePitchClasses(scaleOf(found.quality === 'minor' ? 'aeolian' : 'ionian'), found.tonic),
  );
  const width = 12 * (W + GAP) - GAP;
  return (
    <svg
      role="img"
      aria-label={pitchHistogramLabel(found)}
      data-pitch-histogram
      viewBox={`0 0 ${String(width)} ${String(TOP + H + LABEL)}`}
      className="h-14 w-full max-w-60"
    >
      {histogram.map((value, pitchClass) => {
        const height = Math.max(1, (value / peak) * H);
        const x = pitchClass * (W + GAP);
        const tone = inScale.has(pitchClass);
        return (
          <g key={pitchClass} className={tone ? 'text-primary' : 'text-muted-foreground'}>
            <rect
              x={x}
              y={TOP + H - height}
              width={W}
              height={height}
              rx={1.5}
              fill="currentColor"
              fillOpacity={tone ? 0.9 : 0.4}
            />
            <text
              x={x + W / 2}
              y={TOP + H + LABEL - 2}
              textAnchor="middle"
              fontSize={7}
              fill="currentColor"
            >
              {spellPitchClass(pitchClass, signature, true)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
