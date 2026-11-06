const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * Seconds from the context's clock to the speaker: `outputLatency` where the browser reports it,
 * else `baseLatency`, else 0. Bluetooth output reports 150 ms and more.
 */
export function outputLatencyOf(context: object | undefined): number {
  if (!context) return 0;
  const output = 'outputLatency' in context ? seconds(context.outputLatency) : undefined;
  const base = 'baseLatency' in context ? seconds(context.baseLatency) : undefined;
  return output ?? base ?? 0;
}
