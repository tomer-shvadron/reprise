export const METER_RANGE = 50;

const TICKS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
const IN_TUNE_CENTS = 3;

export const clampCents = (cents: number) => Math.max(-METER_RANGE, Math.min(METER_RANGE, cents));

export const formatCents = (cents: number) => {
  const rounded = Math.round(cents);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${String(Math.abs(rounded))}`;
};

/** A horizontal meter from −50 to +50 cents, with a band around zero for "in tune". */
export function CentsMeter({
  cents,
  label,
  inTune,
  held,
}: {
  /** Cents from the target; undefined with no reading. */
  cents: number | undefined;
  /** The note the meter is measuring, for the accessible value text. */
  label: string;
  inTune: boolean;
  held: boolean;
}) {
  const shown = cents === undefined ? 0 : clampCents(cents);
  const rounded = Math.round(shown);
  const text =
    cents === undefined
      ? 'No reading'
      : inTune
        ? `${label}, in tune`
        : `${label}, ${String(Math.abs(Math.round(cents)))} cents ${cents < 0 ? 'flat' : 'sharp'}`;
  const tone = inTune ? 'bg-emerald-500' : 'bg-foreground';
  return (
    <div
      role="meter"
      aria-label="Tuning"
      aria-valuemin={-METER_RANGE}
      aria-valuemax={METER_RANGE}
      aria-valuenow={rounded}
      aria-valuetext={text}
      data-in-tune={inTune}
      className="relative h-10 w-full"
    >
      <div
        aria-hidden
        className="absolute inset-y-0 rounded bg-emerald-500/20"
        style={{
          left: `${String(((METER_RANGE - IN_TUNE_CENTS) / (2 * METER_RANGE)) * 100)}%`,
          width: `${String(((2 * IN_TUNE_CENTS) / (2 * METER_RANGE)) * 100)}%`,
        }}
      />
      {TICKS.map((tick) => (
        <span
          key={tick}
          aria-hidden
          className={`bg-muted-foreground/50 absolute bottom-0 w-px ${tick === 0 ? 'h-full' : tick % 50 === 0 ? 'h-3/4' : 'h-1/3'}`}
          style={{ left: `${String(((tick + METER_RANGE) / (2 * METER_RANGE)) * 100)}%` }}
        />
      ))}
      {cents !== undefined && (
        // The wrapper spans the meter, so a shift of N percent of it is N cents.
        <div
          aria-hidden
          data-testid="tuner-needle"
          className={`absolute inset-0 transition-transform duration-75 motion-reduce:transition-none ${held ? 'opacity-40' : ''}`}
          style={{ transform: `translateX(${String(shown)}%)` }}
        >
          <span className={`${tone} absolute inset-y-0 left-1/2 -ml-px w-0.5 rounded`} />
        </div>
      )}
    </div>
  );
}
