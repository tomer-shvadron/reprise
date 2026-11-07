import { useMemo } from 'react';

import type { CommandRegistry } from '@/app/command-registry';
import type { KeyboardPlatform } from '@/app/keyboard';
import { CommandSourceContext } from '@/app/use-command';
import { Separator } from '@/components/ui/separator';

import { Announcer } from './announcer';
import { PlaybackButtons } from './playback-buttons';
import { PositionReadout } from './position-readout';
import { PracticeToggles } from './practice-toggles';
import { SoundStatus } from './sound-status';
import { TempoControl } from './tempo-control';
import { MasterVolume } from './volume-control';

interface TransportBarProps {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}

const divider = <Separator orientation="vertical" className="h-6!" />;

/**
 * Not `role="toolbar"`: that role takes the arrow keys for roving focus, and the sliders need them.
 */
export function TransportBar({ registry, keyboard }: TransportBarProps) {
  const source = useMemo(() => ({ registry, keyboard }), [registry, keyboard]);

  return (
    <CommandSourceContext value={source}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          role="group"
          aria-label="Transport controls"
          data-transport-controls
          className="flex shrink-0 items-center gap-2"
        >
          <PlaybackButtons />
          {divider}
          <PositionReadout />
          {divider}
          <TempoControl />
          {divider}
          <PracticeToggles />
        </div>
        <SoundStatus />
        <MasterVolume />
        <Announcer />
      </div>
    </CommandSourceContext>
  );
}
