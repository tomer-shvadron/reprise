/// <reference lib="dom" />
/**
 * The visual suite's `printPdf` command, run in Node: opens a print view of the score demo in a
 * page of its own, measures it, checks every page's geometry in print media, and prints it to
 * PDF the way Chromium's print dialog would.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserCommand } from 'vitest/node';

import { pdfPages } from './pdf-pages.node.ts';
import type { PrintedPdf } from './printed-pdf.ts';

const OUT = fileURLToPath(new URL('../../../.vitest/print/', import.meta.url));

export const printPdf: BrowserCommand<[url: string, name: string], Promise<PrintedPdf>> = async (
  context,
  url,
  name,
) => {
  if (!('context' in context)) throw new Error('printPdf needs the playwright provider');
  const page = await context.context.newPage();
  try {
    const started = performance.now();
    await page.goto(url);
    await page.waitForSelector('.score-print .score-page', { timeout: 110_000 });
    const readyMs = performance.now() - started;

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const metric = (key: string) => metrics.find((entry) => entry.name === key)?.value ?? 0;
    await cdp.detach();

    await page.emulateMedia({ media: 'print' });
    const geometry = await page.evaluate(() => {
      const pages = [...document.querySelectorAll<HTMLElement>('.score-print > .score-page')];
      const first = pages[0]?.getBoundingClientRect().top ?? 0;
      return pages.map((element) => {
        const box = element.getBoundingClientRect();
        const systemsInside = [...element.querySelectorAll('svg[data-system-id]')].every((svg) => {
          const rect = svg.getBoundingClientRect();
          return (
            rect.left >= box.left - 0.5 &&
            rect.top >= box.top - 0.5 &&
            rect.right <= box.right + 0.5 &&
            rect.bottom <= box.bottom + 0.5
          );
        });
        return { top: box.top - first, width: box.width, height: box.height, systemsInside };
      });
    });

    const printing = performance.now();
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    const pdfMs = performance.now() - printing;
    mkdirSync(OUT, { recursive: true });
    const path = join(OUT, `${name}.pdf`);
    writeFileSync(path, pdf);
    const read = pdfPages(pdf);
    return {
      domPages: geometry.length,
      geometry,
      pdfPages: read.count,
      mediaBoxes: read.mediaBoxes,
      pdfBytes: pdf.byteLength,
      readyMs: Math.round(readyMs),
      pdfMs: Math.round(pdfMs),
      nodes: metric('Nodes'),
      jsHeapBytes: metric('JSHeapUsedSize'),
      path,
    };
  } finally {
    await page.close();
  }
};
