import { useEffect } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { ChordsCard } from './cards/chords-card';
import { KeyCard } from './cards/key-card';
import { KeyChangesCard } from './cards/key-changes-card';
import { ScaleCard } from './cards/scale-card';
import { SectionsCard } from './cards/sections-card';
import { ShapeCard } from './cards/shape-card';
import { TracksCard } from './cards/tracks-card';
import { insightsFor } from './insights-for';

function Note({ children }: { children: string }) {
  return <p className="text-muted-foreground p-3 text-sm">{children}</p>;
}

/**
 * The Song tab's Insights view (#353): what the analysis found about the open song. It retains the
 * insights store while mounted, which is what makes the analysis run.
 */
export function InsightsPanel() {
  const services = useAppServices();
  const store = insightsFor(services);
  const score = useStore(services.document, (state) => state.score);
  const { status, insights, slow, error, focus, marked } = useStore(store);
  const currentTrackId = useStore(services.selection, (state) => state.currentTrack);
  const currentTrack = score?.tracks.findIndex((track) => track.id === currentTrackId);

  useEffect(() => {
    const { retain, release } = store.getState();
    retain();
    return release;
  }, [store]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Outside the busy section: a live region inside `aria-busy` may be held back until it clears. */}
      <p role="status" data-insights-status className="sr-only">
        {slow && status === 'analysing' ? 'Analysing…' : ''}
      </p>
      <section
        aria-label="Song insights"
        aria-busy={status === 'analysing'}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <h2 className="sr-only">Song insights</h2>
        {!score ? (
          <Note>Open a song to see insights.</Note>
        ) : insights ? (
          <>
            {score.tracks.every((track) => track.kind === 'drums') ? (
              <Note>No pitched tracks to analyse.</Note>
            ) : (
              <>
                <KeyCard songKey={insights.key} />
                <ScaleCard songKey={insights.key} />
                <KeyChangesCard changes={insights.keyChanges} />
                <SectionsCard
                  insights={insights}
                  currentTrack={
                    currentTrack !== undefined && currentTrack >= 0 ? currentTrack : undefined
                  }
                  focus={focus}
                  marked={marked}
                />
                <ChordsCard chords={insights.chords} />
              </>
            )}
            <ShapeCard shape={insights.shape} />
            <TracksCard insights={insights} />
          </>
        ) : status === 'error' ? (
          <Note>{`The song could not be analysed${error ? `: ${error}` : '.'}`}</Note>
        ) : (
          <Note>{slow ? 'Analysing…' : ' '}</Note>
        )}
      </section>
    </div>
  );
}
