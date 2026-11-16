import { EFFECT_STAGES, type EffectStage } from '@reprise/audio';
import type { Id, Track } from '@reprise/model';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Toggle } from '@/components/ui/toggle';

import { TrackEffectsPicker } from './track-effects-picker';

/**
 * The effects chain, one row per track of the open score: the preset picker and a toggle for each
 * stage. Stage bypass is for trying a preset apart, so it is session state in the engine and it
 * stays out of the mixer (v1 scope). The demo restores what it bypassed when it closes or the
 * document changes, so its toggles never disagree with the engine.
 */
export function EffectsDemo() {
  const { document } = useAppServices();
  const tracks = useStore(document, (state) => state.score?.tracks);
  const documentId = useStore(document, (state) => state.id);
  if (!tracks) return <p className="text-muted-foreground text-sm">Open a file to try effects.</p>;
  return <DemoRows key={documentId} tracks={tracks} />;
}

interface Bypass {
  trackId: Id;
  stage: EffectStage;
}

function DemoRows({ tracks }: { tracks: readonly Track[] }) {
  const { audio } = useAppServices();
  const [bypassed, setBypassed] = useState<ReadonlySet<string>>(new Set());
  const held = useRef(new Map<string, Bypass>());

  useEffect(() => {
    const mine = held.current;
    return () => {
      for (const { trackId, stage } of mine.values()) audio.setStageBypass(trackId, stage, false);
      mine.clear();
    };
  }, [audio]);

  const toggle = (trackId: Id, stage: EffectStage, on: boolean) => {
    audio.setStageBypass(trackId, stage, on);
    const key = `${trackId}:${stage}`;
    if (on) held.current.set(key, { trackId, stage });
    else held.current.delete(key);
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
