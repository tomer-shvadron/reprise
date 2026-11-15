const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 days ago", "yesterday"; "Never" for a song that was never opened. */
export function relativeDate(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) return 'Never';
  const elapsed = now - timestamp;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return formatter.format(-Math.round(elapsed / size), unit);
  }
  return 'Just now';
}
