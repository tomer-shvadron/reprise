import { DEFAULT_MARGINS } from '@reprise/layout';
import { useEffect, useEffectEvent } from 'react';

import { useScoreFonts } from './fonts';
import { PRINT_HEADING, type PrintContent, type PrintHeading } from './print-layout';
import { ScorePage } from './score-page';

import './score.css';

export interface PrintDocumentProps {
  content: PrintContent;
  /** Shown on screen too: the demo's preview and the visual test. The app's copy shows only in print. */
  preview?: boolean;
  /** After the pages are in the DOM, once per content. */
  onReady?: () => void;
}

const margins = DEFAULT_MARGINS.paged;

function PrintHeader({ heading, width }: { heading: PrintHeading; width: number }) {
  return (
    <div
      className="score-print-header"
      style={{
        left: margins.left,
        top: margins.top,
        width: width - margins.left - margins.right,
        height: heading.height,
      }}
    >
      {heading.title !== undefined && (
        <p
          className="score-print-title"
          dir="auto"
          style={{
            fontSize: PRINT_HEADING.titleSize,
            lineHeight: `${String(PRINT_HEADING.titleLine)}px`,
          }}
        >
          {heading.title}
        </p>
      )}
      {heading.byline !== undefined && (
        <p
          className="score-print-byline"
          dir="auto"
          style={{
            fontSize: PRINT_HEADING.bylineSize,
            lineHeight: `${String(PRINT_HEADING.bylineLine)}px`,
          }}
        >
          {heading.byline}
        </p>
      )}
    </div>
  );
}

/**
 * Every page of a print layout, one `ScorePage` each with no virtualization, in the light paper:
 * the title on the first page and a page number on every one. Nothing renders before the fonts.
 */
export function PrintDocument({ content, preview = false, onReady }: PrintDocumentProps) {
  const fontsReady = useScoreFonts();
  const ready = useEffectEvent(() => {
    onReady?.();
  });
  useEffect(() => {
    if (fontsReady) ready();
  }, [fontsReady, content]);
  if (!fontsReady) return null;
  const { result, settings, heading } = content;
  const { pages } = result;
  return (
    <div
      className="score-pages score-print"
      data-paper={settings.paper}
      {...(preview ? { 'data-preview': '' } : { 'aria-hidden': true })}
    >
      {pages.map((page) => (
        <ScorePage
          key={page.index}
          page={page}
          systems={result.systems.slice(page.systems.start, page.systems.end)}
          primitives={result.primitives}
          zoom={1}
        >
          {page.index === 0 && heading && <PrintHeader heading={heading} width={page.bbox.width} />}
          {settings.pageNumbers && (
            <span
              className="score-print-page-number"
              style={{ left: 0, right: 0, bottom: 0, height: margins.bottom }}
            >
              {`${String(page.index + 1)} / ${String(pages.length)}`}
            </span>
          )}
        </ScorePage>
      ))}
    </div>
  );
}
