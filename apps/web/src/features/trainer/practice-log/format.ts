import type { ResumeTarget } from './summary';

/** `< 1 min`, `12 min`, `1 h 05 min`. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export function tempoText(tempo: NonNullable<ResumeTarget['tempo']>): string {
  return tempo.mode === 'percent'
    ? `${String(Math.round(tempo.value))}%`
    : `${String(Math.round(tempo.value))} BPM`;
}

export function barsText(bars: { start: number; end: number } | undefined): string {
  if (!bars) return 'bars removed';
  return bars.start === bars.end
    ? `bar ${String(bars.start)}`
    : `bars ${String(bars.start)}–${String(bars.end)}`;
}
