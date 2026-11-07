const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * Seconds from the context's clock to the speaker: `baseLatency` (the graph to the audio system)
 * plus `outputLatency` (the audio system to the device), each 0 where the browser does not report
 * it. They are successive stages in the Web Audio spec. Bluetooth output reports 150 ms and more.
 */
export function outputLatencyOf(context: object | undefined): number {
  if (!context) return 0;
  const output = 'outputLatency' in context ? seconds(context.outputLatency) : undefined;
  const base = 'baseLatency' in context ? seconds(context.baseLatency) : undefined;
  return (output ?? 0) + (base ?? 0);
}
