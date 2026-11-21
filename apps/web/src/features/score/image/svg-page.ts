/**
 * One page of a `LayoutResult` as a standalone SVG string: the same primitives the painter draws,
 * but with literal sRGB colours, glyphs and text as shapes, and no CSS, class, `currentColor`,
 * `oklch` or font, so it looks the same in a browser, in Inkscape and when rasterised through an
 * `<img>`. Pure: no DOM, no React.
 *
 * Text becomes outlines from the generated tables; a string with a character outside them goes out
 * whole as `<text>` in a sans-serif stack, so a CJK lyric still shows.
 *
 * On a transparent background the painter's paper boxes (they hide staff lines behind fret numbers)
 * would be light patches, so they cut the lines drawn before them through an SVG `<mask>` instead.
 * A tie or slide path crossing a fret number is not cut; the white background is exact.
 */
import { DEFAULT_MARGINS, type LayoutResult, type Page, type Primitive } from '@reprise/layout';

import { textRun, type GeistStyle, type GlyphTable, type Outlines } from './outlines';
import { PALETTE, roleColour } from './palette';
import { PRINT_HEADING, type PrintHeading } from '../print-layout';

export type ImageBackground = 'white' | 'transparent';

export interface PageSvgInput {
  layout: LayoutResult;
  page: Page;
  outlines: Outlines;
  background: ImageBackground;
  /** Drawn only on the first page, as in print. */
  heading?: PrintHeading | undefined;
  /** The `<title>`; the song's title. */
  title?: string | undefined;
  /** A page-relative rectangle to export instead of the whole page. */
  crop?: { x: number; y: number; width: number; height: number } | undefined;
}

const FALLBACK_FAMILY = "Geist, 'Geist Variable', Helvetica, Arial, sans-serif";
/** Geist's content area in font units: what a CSS line box centres its text on. */
const GEIST_ASCENT = 1005;
const GEIST_DESCENT = 295;
const ELLIPSIS = '…';
/** Room kept around a system's primitives in a mask, for what overhangs its box. */
const MASK_PAD = 8;

const margins = DEFAULT_MARGINS.paged;

/** At most two decimals, no `-0`: the output is deterministic and small. */
export function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

// eslint-disable-next-line no-control-regex
const XML_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** A font-unit scale is around 0.01, which two decimals would round away. */
function scale(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function escapeXml(text: string): string {
  // C0 controls other than tab, newline and return are not allowed in XML 1.0.
  return text
    .replaceAll(XML_CONTROLS, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

class Writer {
  /** Code points used, per defs prefix. */
  readonly used = new Map<string, { table: GlyphTable; codepoints: Set<number> }>();
  readonly masks: string[] = [];
  fallbackTexts = 0;

  constructor(private readonly outlines: Outlines) {}

  private mark(prefix: string, table: GlyphTable, codepoint: number): string {
    let entry = this.used.get(prefix);
    if (!entry) {
      entry = { table, codepoints: new Set() };
      this.used.set(prefix, entry);
    }
    entry.codepoints.add(codepoint);
    return `#${prefix}-${String(codepoint)}`;
  }

  glyph(x: number, y: number, size: number, codepoint: number, fill: string): string {
    const { unitsPerEm, glyphs } = this.outlines.bravura;
    if (!glyphs[String(codepoint)]) return '';
    const k = size / unitsPerEm;
    const href = this.mark('b', glyphs, codepoint);
    return `<use xlink:href="${href}" transform="translate(${num(x)} ${num(y)}) scale(${scale(k)} ${scale(-k)})" fill="${fill}"/>`;
  }

  /** Text as outlines; `undefined` when a character is missing, so the caller falls back. */
  outlined(
    text: string,
    style: GeistStyle,
    size: number,
    x: number,
    y: number,
    anchor: 'start' | 'middle' | 'end',
    fill: string,
  ): string | undefined {
    const table = this.outlines.geist.styles[style];
    const run = textRun(text, table);
    if (run.missing) return undefined;
    const k = size / this.outlines.geist.unitsPerEm;
    const shift = anchor === 'middle' ? run.width / 2 : anchor === 'end' ? run.width : 0;
    const uses = run.chars
      .filter(({ codepoint }) => (table[String(codepoint)]?.d ?? '') !== '')
      .map(({ codepoint, x: pen }) => {
        const href = this.mark(`g${style}`, table, codepoint);
        return `<use xlink:href="${href}"${pen === 0 ? '' : ` x="${String(pen)}"`}/>`;
      });
    if (uses.length === 0) return '';
    return `<g transform="translate(${num(x - shift * k)} ${num(y)}) scale(${scale(k)} ${scale(-k)})" fill="${fill}">${uses.join('')}</g>`;
  }

  fallbackText(
    text: string,
    style: GeistStyle,
    size: number,
    x: number,
    y: number,
    anchor: 'start' | 'middle' | 'end',
    fill: string,
  ): string {
    this.fallbackTexts++;
    const weight = style === '600' ? ' font-weight="600"' : '';
    const slant = style === '400i' ? ' font-style="italic"' : '';
    const textAnchor = anchor === 'start' ? '' : ` text-anchor="${anchor}"`;
    return `<text x="${num(x)}" y="${num(y)}" font-family="${FALLBACK_FAMILY}" font-size="${num(size)}"${weight}${slant}${textAnchor} fill="${fill}" xml:space="preserve">${escapeXml(text)}</text>`;
  }

  text(
    text: string,
    style: GeistStyle,
    size: number,
    x: number,
    y: number,
    anchor: 'start' | 'middle' | 'end',
    fill: string,
  ): string {
    return (
      this.outlined(text, style, size, x, y, anchor, fill) ??
      this.fallbackText(text, style, size, x, y, anchor, fill)
    );
  }

  defs(): string {
    const paths: string[] = [];
    for (const [prefix, { table, codepoints }] of this.used) {
      for (const codepoint of [...codepoints].sort((a, b) => a - b)) {
        const glyph = table[String(codepoint)];
        if (glyph) paths.push(`<path id="${prefix}-${String(codepoint)}" d="${glyph.d}"/>`);
      }
    }
    return [...paths, ...this.masks].join('');
  }
}

function primitiveSvg(
  writer: Writer,
  p: Primitive,
  background: ImageBackground,
  maskId: string | undefined,
): string {
  const paper = p.role === 'paper';
  // A transparent image has no paper to match: the box only cuts (the mask), it draws nothing.
  if (paper && background === 'transparent') return '';
  const colour = roleColour(p.role);
  switch (p.kind) {
    case 'glyph':
      return writer.glyph(p.x, p.y, p.size, p.codepoint, colour);
    case 'text':
      return writer.text(p.text, p.italic ? '400i' : '400', p.size, p.x, p.y, p.anchor, colour);
    case 'line': {
      const dash = p.dash ? ` stroke-dasharray="${num(p.dash[0])} ${num(p.dash[1])}"` : '';
      const mask = maskId ? ` mask="url(#${maskId})"` : '';
      return `<line x1="${num(p.x)}" y1="${num(p.y)}" x2="${num(p.x2)}" y2="${num(p.y2)}" stroke="${colour}" stroke-width="${num(p.thickness)}"${dash}${mask}/>`;
    }
    case 'path': {
      const stroked = !p.fill || p.thickness > 0;
      const stroke = stroked ? ` stroke="${colour}" stroke-width="${num(p.thickness)}"` : '';
      return `<path d="${p.d}" fill="${p.fill ? colour : 'none'}"${stroke}/>`;
    }
  }
}

/** The paper boxes of a system, in draw order: filled paths of role `paper`. */
function isBox(p: Primitive): p is Extract<Primitive, { kind: 'path' }> {
  return p.kind === 'path' && p.role === 'paper' && p.fill;
}

/** The system's primitives, the lines cut by the later boxes when the background is transparent. */
function systemBody(
  writer: Writer,
  primitives: readonly Primitive[],
  background: ImageBackground,
  maskPrefix: string,
  region: Rect,
): string {
  const transparent = background === 'transparent';
  // Suffix lists would be quadratic; instead walk backwards collecting the boxes seen so far.
  const later: (readonly Extract<Primitive, { kind: 'path' }>[])[] = [];
  if (transparent) {
    const boxes: Extract<Primitive, { kind: 'path' }>[] = [];
    for (let i = primitives.length - 1; i >= 0; i--) {
      const p = primitives[i];
      if (p === undefined) continue;
      if (p.kind === 'line') {
        later[i] = boxes.filter((box) => overlaps(box.bbox, p.bbox));
      } else if (isBox(p)) {
        boxes.push(p);
      }
    }
  }
  const maskIds = new Map<string, string>();
  const out: string[] = [];
  primitives.forEach((p, i) => {
    let maskId: string | undefined;
    const cuts = later[i];
    if (cuts && cuts.length > 0) {
      const key = cuts.map((box) => box.d).join('|');
      maskId = maskIds.get(key);
      if (!maskId) {
        maskId = `${maskPrefix}${String(maskIds.size)}`;
        maskIds.set(key, maskId);
        const holes = cuts.map((box) => `<path d="${box.d}" fill="#000000"/>`).join('');
        writer.masks.push(
          `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}"><rect x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}" fill="#ffffff"/>${holes}</mask>`,
        );
      }
    }
    out.push(primitiveSvg(writer, p, background, maskId));
  });
  return out.join('');
}

/** Cuts a string to fit `max` px, ending in an ellipsis, like `text-overflow: ellipsis`. */
function fitted(text: string, style: GeistStyle, size: number, max: number, outlines: Outlines) {
  const table = outlines.geist.styles[style];
  const k = size / outlines.geist.unitsPerEm;
  const widthOf = (value: string) => textRun(value, table).width * k;
  if (textRun(text, table).missing || widthOf(text) <= max) return text;
  const characters = Array.from(text);
  while (characters.length > 0 && widthOf(characters.join('') + ELLIPSIS) > max) characters.pop();
  return characters.join('').trimEnd() + ELLIPSIS;
}

function headerSvg(writer: Writer, heading: PrintHeading, page: Page, outlines: Outlines): string {
  const width = page.bbox.width - margins.left - margins.right;
  const centre = margins.left + width / 2;
  const content = (GEIST_ASCENT + GEIST_DESCENT) / 1000;
  const rows: string[] = [];
  let top = margins.top;
  const row = (text: string, style: GeistStyle, size: number, line: number, fill: string): void => {
    const cut = fitted(text, style, size, width, outlines);
    const baseline = top + (line - content * size) / 2 + (GEIST_ASCENT / 1000) * size;
    rows.push(writer.text(cut, style, size, centre, baseline, 'middle', fill));
    top += line;
  };
  if (heading.title !== undefined) {
    row(heading.title, '600', PRINT_HEADING.titleSize, PRINT_HEADING.titleLine, PALETTE.ink);
  }
  if (heading.byline !== undefined) {
    row(heading.byline, '400', PRINT_HEADING.bylineSize, PRINT_HEADING.bylineLine, PALETTE.muted);
  }
  return rows.join('');
}

/** The standalone SVG of one page. Deterministic: the same input gives the same string. */
export function pageSvg(input: PageSvgInput): string {
  const { layout, page, outlines, background, heading, title } = input;
  const crop = input.crop ?? { x: 0, y: 0, width: page.bbox.width, height: page.bbox.height };
  const writer = new Writer(outlines);
  const body: string[] = [];

  layout.systems.slice(page.systems.start, page.systems.end).forEach((system, index) => {
    const frameX = system.bbox.x - (system.offsetX ?? 0);
    const region: Rect = {
      x: frameX - MASK_PAD,
      y: system.bbox.y - MASK_PAD,
      width: system.bbox.width + 2 * MASK_PAD,
      height: system.bbox.height + 2 * MASK_PAD,
    };
    // Primitives are in the system's own frame (continuous segments are shifted by `offsetX`).
    const dx = (system.offsetX ?? 0) - page.bbox.x - crop.x;
    const dy = -page.bbox.y - crop.y;
    const primitives = layout.primitives.slice(system.primitives.start, system.primitives.end);
    const inner = systemBody(writer, primitives, background, `m${String(index)}-`, region);
    body.push(`<g transform="translate(${num(dx)} ${num(dy)})">${inner}</g>`);
  });

  if (page.index === 0 && heading) {
    body.push(
      `<g transform="translate(${num(-crop.x)} ${num(-crop.y)})">${headerSvg(writer, heading, page, outlines)}</g>`,
    );
  }

  const w = num(crop.width);
  const h = num(crop.height);
  const rect =
    background === 'white' ? `<rect width="${w}" height="${h}" fill="${PALETTE.white}"/>` : '';
  const titleTag = title ? `<title>${escapeXml(title)}</title>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `${titleTag}<defs>${writer.defs()}</defs>\n${rect}${body.join('\n')}\n</svg>\n`
  );
}
