import { PAGE_SIZES } from '@reprise/layout';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { ScoreView } from '@/features/score';

import { useAppServices } from './services-context';

function EmptyPaper({ children }: { children: ReactNode }) {
  const { ui } = useAppServices();
  const { zoom, paper } = useStore(
    ui,
    useShallow((state) => ({ zoom: state.zoom, paper: state.view.paper })),
  );
  const size = PAGE_SIZES[paper];
  return (
    <div className="h-full overflow-auto">
      <div className="w-max min-w-full p-8">
        <div
          className="bg-paper text-ink mx-auto p-12 shadow-md"
          style={{ width: size.width * zoom, minHeight: size.height * zoom }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function ScorePane({ hint }: { hint: ReactNode }) {
  const { document, layout, ui } = useAppServices();
  const { result, error } = useStore(
    layout,
    useShallow((state) => ({ result: state.result, error: state.error })),
  );
  const { opening, title, fileName } = useStore(
    document,
    useShallow((state) => ({
      opening: state.opening,
      title: state.score?.meta.title,
      fileName: state.file?.name,
    })),
  );
  const zoom = useStore(ui, (state) => state.zoom);

  if (error !== undefined) {
    return (
      <EmptyPaper>
        <p role="alert">
          This score could not be drawn. <span className="text-ink-muted">{error}</span>
        </p>
      </EmptyPaper>
    );
  }
  if (!result) {
    return (
      <EmptyPaper>
        {opening === undefined ? hint : <p className="text-ink-muted">Opening {opening}…</p>}
      </EmptyPaper>
    );
  }
  const name = title?.trim() ? title : (fileName ?? 'Untitled');
  return (
    <ScoreView
      layout={result}
      zoom={zoom}
      label={`Score: ${name}`}
      className="h-full focus-visible:-outline-offset-2"
    />
  );
}
