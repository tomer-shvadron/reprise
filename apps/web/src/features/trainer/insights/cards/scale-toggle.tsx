import { useStore } from 'zustand';

import { CommandTooltip, HintTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import type { ScaleId } from '@/lib/insights';

import { scaleOverlayFor } from '../../fretboard/scale-overlay';
import { showScaleOnFretboard } from '../show-scale';

interface Props {
  tonic: number;
  scaleId: ScaleId;
  /** The scale's name, which is the visible text of the control. */
  name: string;
  /** Whose scale it is, for the accessible name: `for Lead in Verse`. */
  whose?: string;
  /** The song's own scale: it goes through its command, which follows the score as it is edited. */
  songScale: { tonic: number; scaleId: ScaleId } | undefined;
}

const LOOK =
  'text-foreground aria-pressed:bg-accent h-auto px-1 py-0.5 text-xs underline decoration-dotted underline-offset-2';

/**
 * A scale's name that is also its switch: it marks the scale on the fretboard, and marks it again
 * to hide it. The song's own scale runs `trainer.fretboardSongScale`; any other sets a section
 * overlay, which describes that stretch and does not follow edits.
 */
export function ScaleToggle({ tonic, scaleId, name, whose, songScale }: Props) {
  const services = useAppServices();
  const overlays = scaleOverlayFor(services);
  const overlay = useStore(overlays, (state) => state.overlay);
  const showSong = useCommand('trainer.fretboardSongScale');
  const clear = useCommand('trainer.fretboardClearScale');
  const pressed =
    overlay !== undefined &&
    !overlay.none &&
    overlay.tonic === tonic &&
    overlay.scaleId === scaleId;
  const isSong = songScale?.tonic === tonic && songScale.scaleId === scaleId;
  const label = `Show ${name}${whose ? ` for ${whose}` : ''} on fretboard`;
  const button = (
    <Button
      variant="ghost"
      size="xs"
      className={LOOK}
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => {
        if (pressed) clear.run();
        else if (isSong) showSong.run();
        else showScaleOnFretboard(services, tonic, scaleId);
      }}
    >
      {name}
    </Button>
  );
  return isSong ? (
    <CommandTooltip command="trainer.fretboardSongScale" label="Show on fretboard">
      {button}
    </CommandTooltip>
  ) : (
    <HintTooltip label={pressed ? 'Hide from fretboard' : 'Show on fretboard'}>
      {button}
    </HintTooltip>
  );
}
