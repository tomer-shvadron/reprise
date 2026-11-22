import type { Factor, SongInsights, TechName, TrackStats } from '@/lib/insights';
import { SHIFT_FRETS } from '@/lib/insights';

import { songScaleOf } from '../../fretboard/scale-overlay';

import { InsightCard } from './card';
import { ScaleToggle } from './scale-toggle';

interface TechniqueWording {
  one: string;
  many: string;
  /** A noun that does not count ("palm muting"): shown as "palm muting on 4 notes". */
  mass?: true;
  /** Counted per beat, not per note (the beat effects). */
  beats?: true;
}

const TECHNIQUES: Record<TechName, TechniqueWording> = {
  bend: { one: 'bend', many: 'bends' },
  bendWide: { one: 'wide bend', many: 'wide bends' },
  slide: { one: 'slide', many: 'slides' },
  hammerPull: { one: 'hammer-on or pull-off', many: 'hammer-ons and pull-offs' },
  vibrato: { one: 'vibrato', many: 'vibrato', mass: true },
  palmMute: { one: 'palm muting', many: 'palm muting', mass: true },
  letRing: { one: 'let ring', many: 'let ring', mass: true },
  trill: { one: 'trill', many: 'trills' },
  staccato: { one: 'staccato', many: 'staccato', mass: true },
  accent: { one: 'accent', many: 'accents' },
  harmonicHard: { one: 'artificial harmonic', many: 'artificial harmonics' },
  tapping: { one: 'tapping', many: 'tapping', mass: true, beats: true },
  tremoloPicking: { one: 'tremolo picking', many: 'tremolo picking', mass: true, beats: true },
  whammy: { one: 'whammy bar', many: 'whammy bar', mass: true, beats: true },
  slap: { one: 'slap', many: 'slaps', beats: true },
  pop: { one: 'pop', many: 'pops', beats: true },
  arpeggio: { one: 'arpeggio', many: 'arpeggios', beats: true },
  brush: { one: 'brush stroke', many: 'brush strokes', beats: true },
};

function techniqueText(name: TechName, count: number): string {
  const wording = TECHNIQUES[name];
  const unit = wording.beats ? 'beat' : 'note';
  const noun = `${String(count)} ${count === 1 ? unit : `${unit}s`}`;
  return wording.mass
    ? `${wording.one} on ${noun}`
    : `${String(count)} ${count === 1 ? wording.one : wording.many}`;
}

const one = (value: number): string => String(Math.round(value * 10) / 10);

/** One factor of the difficulty as a sentence; the values are the 90th percentile of the track, said so. */
function factorText(factor: Factor): string {
  const rating = `${String(factor.band)} of 5`;
  switch (factor.id) {
    case 'speed':
      return `Speed: 90% of the passages stay under ${one(factor.value)} notes a second (${rating})`;
    case 'shifts':
      return `Position shifts: ${String(Math.round(factor.value))} a minute (${rating})`;
    case 'stretch':
      return `Stretch: 90% of the beats fit within ${one(factor.value)} frets (${rating})`;
    case 'techniques':
      return `Hard techniques: ${String(Math.round(factor.value * 100))}% of the notes: tapping, wide bends, tremolo picking, artificial harmonics (${rating})`;
    case 'fret':
      return `Frets: 90% of the notes are at fret ${String(Math.round(factor.value))} or lower (${rating})`;
  }
}

function TrackRow({
  stats,
  songScale,
}: {
  stats: TrackStats;
  songScale: ReturnType<typeof songScaleOf>;
}) {
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
              Techniques:{' '}
              {techniques
                .map((technique) => techniqueText(technique.name, technique.count))
                .join(', ')}
            </p>
          )}
          {scale && (
            <p>
              <ScaleToggle
                tonic={scale.tonic}
                scaleId={scale.id}
                name={scale.name}
                whose={stats.name}
                songScale={songScale}
              />
            </p>
          )}
        </>
      )}
      {difficulty && (
        <details>
          <summary className="cursor-pointer">
            Difficulty {String(difficulty.rating)} of 5 (rough)
          </summary>
          <p className="text-muted-foreground pt-0.5">
            A rough guide from these factors; speed counts most.
          </p>
          <ul className="text-muted-foreground list-disc pl-4">
            {difficulty.factors.map((factor) => (
              <li key={factor.id}>{factorText(factor)}</li>
            ))}
          </ul>
          {difficulty.factors.some((factor) => factor.id === 'shifts') && (
            <p className="text-muted-foreground pt-0.5">
              A shift is a move of more than {String(SHIFT_FRETS)} frets between notes. Stretch is
              the widest span under the hand within a beat.
            </p>
          )}
        </details>
      )}
    </li>
  );
}

/** One row per track: its range, frets and position, techniques, scale and a rough difficulty. */
export function TracksCard({ insights }: { insights: SongInsights }) {
  const songScale = songScaleOf(insights);
  if (insights.tracks.length === 0) return null;
  return (
    <InsightCard title="Tracks" data-insight-card="tracks">
      <ul className="flex flex-col gap-2.5">
        {insights.tracks.map((stats) => (
          <TrackRow key={stats.track} stats={stats} songScale={songScale} />
        ))}
      </ul>
    </InsightCard>
  );
}
