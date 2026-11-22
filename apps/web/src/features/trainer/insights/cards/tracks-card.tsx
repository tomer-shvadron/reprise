import type { Factor, SongInsights, TrackStats } from '@/lib/insights';

import { InsightCard } from './card';
import { ShowScaleButton } from './show-scale-button';

const FACTOR_NAMES: Record<Factor['id'], string> = {
  speed: 'Speed',
  shifts: 'Position shifts',
  stretch: 'Stretch',
  techniques: 'Demanding techniques',
  fret: 'Highest fret',
};

const TECHNIQUE_NAMES: Record<string, string> = {
  bend: 'bends',
  bendWide: 'wide bends',
  tremoloPicking: 'tremolo picking',
  harmonicHard: 'hard harmonics',
};

const techniqueName = (name: string): string =>
  TECHNIQUE_NAMES[name] ??
  name
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();

function factorValue(factor: Factor): string {
  if (factor.id === 'techniques') return `${String(Math.round(factor.value * 100))}% of notes`;
  const rounded = Math.round(factor.value * 10) / 10;
  return `${String(rounded)} ${factor.unit}`;
}

function TrackRow({ stats, tonic }: { stats: TrackStats; tonic: number | undefined }) {
  const { range, frets, scale, drums, difficulty, techniques } = stats;
  return (
    <li className="flex flex-col gap-0.5 text-xs" data-insight-track={stats.name}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{stats.name}</span>
        <span className="text-muted-foreground">
          {stats.notes} {stats.notes === 1 ? 'note' : 'notes'}
        </span>
      </div>
      {drums ? (
        <p className="text-muted-foreground">
          Drums: {drums.top.map((use) => `${use.name} (${String(use.count)})`).join(', ')}
        </p>
      ) : (
        <>
          {range && (
            <p className="text-muted-foreground">
              Range {range.lowName} – {range.highName}
              {frets &&
                `, frets ${String(frets.lowest)} to ${String(frets.highest)}${
                  frets.position
                    ? `, mostly frets ${String(frets.position.from)}–${String(frets.position.to)}`
                    : ''
                }`}
            </p>
          )}
          {techniques.length > 0 && (
            <p className="text-muted-foreground">
              {techniques
                .map((technique) => `${techniqueName(technique.name)} (${String(technique.count)})`)
                .join(', ')}
            </p>
          )}
          {scale && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground">{scale.name}</span>
              {tonic !== undefined && (
                <ShowScaleButton
                  tonic={tonic}
                  scaleId={scale.id}
                  what={`${scale.name} for ${stats.name}`}
                />
              )}
            </div>
          )}
        </>
      )}
      {difficulty && (
        <details>
          <summary className="cursor-pointer">
            Difficulty {String(difficulty.rating)} of 5 (rough)
          </summary>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 pt-0.5">
            {difficulty.factors.map((factor) => (
              <div key={factor.id} className="contents">
                <dt>{FACTOR_NAMES[factor.id]}</dt>
                <dd>
                  {factorValue(factor)}, {String(factor.band)} of 5
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

/** One row per track: its range, frets and position, techniques, scale and a rough difficulty. */
export function TracksCard({ insights }: { insights: SongInsights }) {
  const tonic = insights.key.found ? insights.key.tonic : undefined;
  if (insights.tracks.length === 0) return null;
  return (
    <InsightCard title="Tracks" data-insight-card="tracks">
      <ul className="flex flex-col gap-2.5">
        {insights.tracks.map((stats) => (
          <TrackRow key={stats.track} stats={stats} tonic={tonic} />
        ))}
      </ul>
    </InsightCard>
  );
}
