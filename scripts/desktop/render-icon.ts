/**
 * Renders apps/desktop/resources/icon.svg into the two 1024 px app icons and a preview sheet, with
 * the Playwright Chromium the repo already installs:
 *
 *   pnpm desktop:icon
 *
 * `icon.png` is full bleed (Windows); `icon-mac.png` is the macOS grid, an 824 px rounded body in
 * a transparent 1024 px canvas. electron-builder converts them to .icns and .ico.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Page } from 'playwright';

const RESOURCES = join(import.meta.dirname, '../../apps/desktop/resources');
const SIZE = 1024;
const MAC_BODY = 824;
const MAC_RADIUS = 185;
const PREVIEW_SIZES = [16, 32, 64, 128, 256];

const svg = readFileSync(join(RESOURCES, 'icon.svg'), 'utf8');
const px = (value: number): string => `${String(value)}px`;
const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

async function render(page: Page, html: string, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  return page.screenshot({ omitBackground: true, type: 'png' });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const full = await render(
    page,
    `<div style="width:${px(SIZE)};height:${px(SIZE)}">${svg.replace('<svg ', `<svg style="width:${px(SIZE)};height:${px(SIZE)}" `)}</div>`,
    SIZE,
    SIZE,
  );
  const inset = (SIZE - MAC_BODY) / 2;
  const mac = await render(
    page,
    `<div style="position:absolute;left:${px(inset)};top:${px(inset)};width:${px(MAC_BODY)};height:${px(MAC_BODY)};border-radius:${px(MAC_RADIUS)};overflow:hidden"><img src="${dataUrl(full)}" style="width:100%;height:100%"></div>`,
    SIZE,
    SIZE,
  );
  writeFileSync(join(RESOURCES, 'icon.png'), full);
  writeFileSync(join(RESOURCES, 'icon-mac.png'), mac);

  const row = (background: string): string =>
    `<div style="background:${background};padding:24px;display:flex;gap:24px;align-items:flex-end">${PREVIEW_SIZES.map((size) => `<img src="${dataUrl(mac)}" width="${String(size)}" height="${String(size)}" style="image-rendering:auto">`).join('')}<img src="${dataUrl(full)}" width="128" height="128" style="border-radius:0"></div>`;
  const preview = await render(
    page,
    `<div style="width:max-content">${row('#f4f4f6')}${row('#1c1c1e')}</div>`,
    792,
    608,
  );
  writeFileSync(join(RESOURCES, 'icon-preview.png'), preview);
} finally {
  await browser.close();
}
