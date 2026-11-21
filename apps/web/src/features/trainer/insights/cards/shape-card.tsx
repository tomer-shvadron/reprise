import type { SongInsights } from '@/lib/insights';

import { InsightCard } from './card';

const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
};

const bpm = (value: number): string => String(Math.round(value));

export function ShapeCard({ shape }: { shape: SongInsights['shape'] }) {
  const { tempo } = shape;
  const tempoText =
    tempo.min === tempo.max
      ? `${bpm(tempo.start)} BPM`
      : `${bpm(tempo.start)} BPM, ranging ${bpm(tempo.min)} to ${bpm(tempo.max)}`;
  const bars =
    shape.barsPlayed === shape.barsWritten
      ? `${String(shape.barsWritten)} bars`
      : `${String(shape.barsPlayed)} bars played (${String(shape.barsWritten)} written)`;
  return (
    <InsightCard title="Shape" data-insight-card="shape">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">Length</dt>
        <dd>{clock(shape.seconds)}</dd>
        <dt className="text-muted-foreground">Bars</dt>
        <dd>{bars}</dd>
        <dt className="text-muted-foreground">Tempo</dt>
        <dd>{tempoText}</dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd>
          {shape.timeSignatures
            .map((time) => `${String(time.numerator)}/${String(time.denominator)}`)
            .join(', ')}
        </dd>
        {shape.sections.length > 0 && (
          <>
            <dt className="text-muted-foreground">Sections</dt>
            <dd>{shape.sections.length}</dd>
          </>
        )}
      </dl>
    </InsightCard>
  );
}
