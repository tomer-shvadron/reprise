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
  /** The paper's height in layout px: the page's unless a caller crops it. */
  height?: number;
  style?: CSSProperties;
  /** Drawn inside the page box, above the systems: a print header, a page number. */
  children?: ReactNode;
}

/**
 * A paper rectangle and its systems, placed relative to the page. It carries the score tokens
 * itself, so it paints alone, outside a `ScoreView` or `ScorePages`.
 */
export function ScorePage({
  page,
  systems,
  primitives,
  zoom,
  height = page.bbox.height,
  style,
  children,
}: ScorePageProps) {
  const size: CSSProperties & Record<`--${string}`, string> = {
    width: page.bbox.width * zoom,
    '--score-paper-height': `${String(height * zoom)}px`,
    '--score-page-height': `${String(page.bbox.height * zoom)}px`,
  };
  return (
    <div
      className="score-page shadow-md print:shadow-none"
      data-page={page.index}
      style={{ ...size, ...style }}
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
