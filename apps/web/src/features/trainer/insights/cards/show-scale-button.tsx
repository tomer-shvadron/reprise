import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import type { ScaleId } from '@/lib/insights';

import { showScaleOnFretboard } from '../show-scale';

/** "Show on fretboard" for one scale; `what` names it for a screen reader among the many on the panel. */
export function ShowScaleButton({
  tonic,
  scaleId,
  what,
}: {
  tonic: number;
  scaleId: ScaleId;
  what: string;
}) {
  const services = useAppServices();
  return (
    <Button
      variant="outline"
      size="xs"
      className="self-start"
      aria-label={`Show ${what} on fretboard`}
      onClick={() => {
        showScaleOnFretboard(services, tonic, scaleId);
      }}
    >
      Show on fretboard
    </Button>
  );
}
