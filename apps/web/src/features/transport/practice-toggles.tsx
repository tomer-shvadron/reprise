import { ChevronUpIcon, MetronomeIcon, RepeatIcon, TimerIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useAppServices } from '@/app/services-context';

import { TransportToggle } from './controls';
import { LevelPopover } from './level-popover';
import { loopBarNumbers } from './loop';

export function PracticeToggles() {
  const { playback, document, audio } = useAppServices();
  const { loop, countIn, metronome } = useStore(
    playback,
    useShallow((state) => ({
      loop: state.settings.loop,
      countIn: state.settings.countIn,
      metronome: state.settings.metronome,
    })),
  );
  const score = useStore(document, (state) => state.score);
  const bars = loop && loopBarNumbers(score, loop);
  const range =
    bars &&
    (bars.start === bars.end ? String(bars.start) : `${String(bars.start)}–${String(bars.end)}`);

  return (
    <div role="group" aria-label="Practice" className="flex items-center gap-0.5">
      <TransportToggle
        command="transport.toggleLoop"
        label="Loop"
        tip={range ? `Loop bars ${range}` : 'Loop'}
        pressed={loop !== undefined}
        disabled={!score}
      >
        <RepeatIcon />
        {range && <span className="text-xs tabular-nums">{range}</span>}
      </TransportToggle>
      <TransportToggle command="transport.toggleCountIn" label="Count-in" pressed={countIn}>
        <TimerIcon />
      </TransportToggle>
      <TransportToggle command="transport.toggleMetronome" label="Metronome" pressed={metronome.on}>
        <MetronomeIcon />
      </TransportToggle>
      <LevelPopover
        popover="metronome"
        command="transport.metronomeVolume"
        label="Metronome volume"
        value={metronome.volume}
        note="Also the count-in’s volume."
        onChange={(volume) => {
          audio.setMetronome(playback.getState().settings.metronome.on, volume);
        }}
      >
        <ChevronUpIcon />
      </LevelPopover>
    </div>
  );
}
