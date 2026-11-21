import { useEffect } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { KeyCard } from './cards/key-card';
import { KeyChangesCard } from './cards/key-changes-card';
import { ScaleCard } from './cards/scale-card';
import { ShapeCard } from './cards/shape-card';
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
  const { status, insights, forScore, slow, error } = useStore(store);

  useEffect(() => {
    const { retain, release } = store.getState();
    retain();
    return release;
  }, [store]);

  const current = insights && forScore === score ? insights : undefined;
  // While a newer result is being worked out, the last one stays up.
  const shown = current ?? insights;

  return (
    <section
      aria-label="Song insights"
      aria-busy={status === 'analysing'}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <p role="status" className="sr-only">
        {slow && status === 'analysing' ? 'Analysing…' : ''}
      </p>
      {!score ? (
        <Note>Open a song to see insights.</Note>
      ) : shown ? (
        <>
          {score.tracks.every((track) => track.kind === 'drums') ? (
            <Note>No pitched tracks to analyse.</Note>
          ) : (
            <>
              <KeyCard songKey={shown.key} />
              <ScaleCard songKey={shown.key} />
              <KeyChangesCard changes={shown.keyChanges} />
            </>
          )}
          <ShapeCard shape={shown.shape} />
        </>
      ) : status === 'error' ? (
        <Note>{`The song could not be analysed${error ? `: ${error}` : '.'}`}</Note>
      ) : (
        <Note>{slow ? 'Analysing…' : ' '}</Note>
      )}
    </section>
  );
}
