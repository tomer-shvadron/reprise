import { EFFECT_STAGES, type EffectStage } from '@reprise/audio';
import { useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Toggle } from '@/components/ui/toggle';

import { TrackEffectsPicker } from './track-effects-picker';

/**
 * The effects chain, one row per track of the open score: the preset picker and a toggle for each
 * stage. Stage bypass is for trying a preset apart, so it is session state in the engine, cleared
 * when the song unloads, and it stays out of the mixer (v1 scope).
 */
export function EffectsDemo() {
  const { document, audio } = useAppServices();
  const tracks = useStore(document, (state) => state.score?.tracks);
  const [bypassed, setBypassed] = useState<ReadonlySet<string>>(new Set());
  if (!tracks) return <p className="text-muted-foreground text-sm">Open a file to try effects.</p>;

  const toggle = (trackId: string, stage: EffectStage, on: boolean) => {
    audio.debug().engine.setStageBypass(trackId, stage, on);
    const key = `${trackId}:${stage}`;
    setBypassed((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <section aria-label="Track effects" className="flex flex-col gap-3">
      {tracks.map((track, index) => {
        const label = track.name || `Track ${String(index + 1)}`;
        return (
          <div key={track.id} role="group" aria-label={label} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{label}</span>
            <TrackEffectsPicker trackId={track.id} label={label} />
            <div className="flex flex-wrap gap-1">
              {EFFECT_STAGES.map((stage) => (
                <Toggle
                  key={stage}
                  size="sm"
                  aria-label={`Bypass ${stage} on ${label}`}
                  pressed={bypassed.has(`${track.id}:${stage}`)}
                  onPressedChange={(on) => {
                    toggle(track.id, stage, on);
                  }}
                >
                  {stage}
                </Toggle>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
