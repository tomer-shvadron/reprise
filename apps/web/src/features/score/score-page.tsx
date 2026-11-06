import type { LayoutResult, Page, Primitive, System } from '@reprise/layout';
import type { CSSProperties, ReactNode } from 'react';

import { useScoreFonts } from './fonts';
import { SystemSvg } from './system-svg';

import './score.css';

export interface ScorePageProps {
  page: Page;
  /** The systems of this page to mount. */
  systems: readonly System[];
  /** The layout's flat primitive array. */
  primitives: readonly Primitive[];
  zoom: number;
  style?: CSSProperties;
  /** Drawn inside the page box, above the systems: a print header, a page number. */
  children?: ReactNode;
}

/** A paper rectangle and its systems, placed relative to the page. */
export function ScorePage({ page, systems, primitives, zoom, style, children }: ScorePageProps) {
  return (
    <div
      className="score-page shadow-md print:shadow-none"
      data-page={page.index}
      style={{ width: page.bbox.width * zoom, height: page.bbox.height * zoom, ...style }}
    >
      {systems.map((system) => (
        <SystemSvg
          key={system.id}
          system={system}
          primitives={primitives}
          zoom={zoom}
          left={(system.bbox.x - page.bbox.x) * zoom}
          top={(system.bbox.y - page.bbox.y) * zoom}
        />
      ))}
      {children}
    </div>
  );
}

export interface ScorePagesProps {
  layout: LayoutResult;
  zoom?: number;
}

/** Every page and system with no virtualization: the print path. Nothing renders before the fonts. */
export function ScorePages({ layout, zoom = 1 }: ScorePagesProps) {
  const fontsReady = useScoreFonts();
  if (!fontsReady) return null;
  return (
    <div className="score-pages">
      {layout.pages.map((page) => (
        <ScorePage
          key={page.index}
          page={page}
          systems={layout.systems.slice(page.systems.start, page.systems.end)}
          primitives={layout.primitives}
          zoom={zoom}
        />
      ))}
    </div>
  );
}
