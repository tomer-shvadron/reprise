/**
 * Renders apps/desktop/resources/icon.svg into the two 1024 px app icons and a preview sheet, with
 * the Playwright Chromium the repo already installs:
 *
 *   pnpm desktop:icon
 *
 * `icon.png` is full bleed (Windows); `icon-mac.png` is the macOS grid, an 824 px rounded body in
 * a transparent 1024 px canvas, drawn directly (not the full-bleed image shrunk) so its edge is
 * not clipped at the corners. electron-builder converts them to .icns and .ico.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Page } from 'playwright';

const RESOURCES = join(import.meta.dirname, '../../apps/desktop/resources');
const SIZE = 1024;
const MAC_BODY = 824;
const MAC_RADIUS = 185;
const TILE_FILL = '#434a85';
const TILE_EDGE = '#a8b0f0';
const EDGE_WIDTH = 16;
const PREVIEW_SIZES = [16, 32, 64, 128, 256];
// Nearest-neighbour enlargements, to judge the smallest sizes pixel by pixel.
const ZOOMED = [16, 32];
const ZOOM = 8;

const svg = readFileSync(join(RESOURCES, 'icon.svg'), 'utf8');
const mark = /<g id="mark"[\s\S]*?<\/g>/.exec(svg)?.[0] ?? '';
if (!mark) throw new Error('icon.svg has no <g id="mark">');
const half = EDGE_WIDTH / 2;
const inset = (SIZE - MAC_BODY) / 2;
const macSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(SIZE)} ${String(SIZE)}"><rect x="${String(inset + half)}" y="${String(inset + half)}" width="${String(MAC_BODY - EDGE_WIDTH)}" height="${String(MAC_BODY - EDGE_WIDTH)}" rx="${String(MAC_RADIUS - half)}" fill="${TILE_FILL}" stroke="${TILE_EDGE}" stroke-width="${String(EDGE_WIDTH)}"/>${mark}</svg>`;
const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

const svgAt = (markup: string, size: number): string =>
  `<div style="width:${String(size)}px;height:${String(size)}px">${markup.replace('<svg ', `<svg style="width:${String(size)}px;height:${String(size)}px" `)}</div>`;

async function render(page: Page, html: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  return page.screenshot({ omitBackground: true, type: 'png' });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const full = await render(page, svgAt(svg, SIZE), SIZE, SIZE);
  const mac = await render(page, svgAt(macSvg, SIZE), SIZE, SIZE);
  writeFileSync(join(RESOURCES, 'icon.png'), full);
  writeFileSync(join(RESOURCES, 'icon-mac.png'), mac);

  // The preview scales the real 1024 px PNGs, as the OS does when it picks an icon size.
  const img = (png: Buffer, size: number, style = ''): string =>
    `<img src="${dataUrl(png)}" width="${String(size)}" height="${String(size)}" style="${style}">`;
  const row = (background: string): string =>
    `<div style="background:${background};padding:24px;display:flex;gap:24px;align-items:flex-end">${PREVIEW_SIZES.map((size) => img(mac, size)).join('')}${img(full, 128)}</div>`;
  // 16 and 32 px are first drawn at size, then enlarged, so the pixels shown are the small icon's.
  const small = await Promise.all(
    ZOOMED.map(async (size) => {
      const shot = await render(page, img(mac, size), size, size);
      return { size, shot };
    }),
  );
  const zoom = (background: string): string =>
    `<div style="background:${background};padding:24px;display:flex;gap:24px;align-items:flex-end">${small.map(({ size, shot }) => img(shot, size * ZOOM, 'image-rendering:pixelated')).join('')}</div>`;
  const preview = await render(
    page,
    `<div style="width:max-content">${row('#f4f4f6')}${row('#1c1c1e')}${zoom('#f4f4f6')}${zoom('#1c1c1e')}</div>`,
    792,
    1220,
  );
  writeFileSync(join(RESOURCES, 'icon-preview.png'), preview);
} finally {
  await browser.close();
}
