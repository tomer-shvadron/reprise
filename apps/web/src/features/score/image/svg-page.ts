/**
 * One page of a `LayoutResult` as a standalone SVG string: the same primitives the painter draws,
 * but with literal sRGB colours, glyphs and text as shapes, and no CSS, class, `currentColor`,
 * `oklch` or font, so it looks the same in a browser, in Inkscape and when rasterised through an
 * `<img>`. Pure: no DOM, no React.
 *
 * Text becomes outlines from the generated tables; a string with a character outside them goes out
 * whole as `<text>` in a sans-serif stack, so a CJK lyric still shows. Italic is the painter's
 * synthetic oblique of the upright face: the same outlines under a skew.
 *
 * On a transparent background the painter's paper boxes (they hide staff lines behind fret numbers)
 * would be light patches, so they cut the lines drawn before them through an SVG `<mask>` instead.
 * A tie or slide path crossing a fret number is not cut; the white background is exact.
 */
import { DEFAULT_MARGINS, type LayoutResult, type Page, type Primitive } from '@reprise/layout';

import { ITALIC_SKEW, textRun, type GeistStyle, type GlyphTable, type Outlines } from './outlines';
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
const ELLIPSIS = '…';
/** What a masked line keeps around its own extent, beyond its thickness, so its caps are not cut. */
const MASK_PAD = 2;
/** The width assumed for a character with no outline when cutting a heading to fit: one em. */
const UNKNOWN_ADVANCE_EM = 1;

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

export interface PageSvgReport {
  svg: string;
  /** Strings that went out as `<text>` because a character has no outline. */
  fallbackTexts: number;
  /** Glyph primitives with no outline in the table: dropped, so the tables are stale. */
  missingGlyphs: number;
}

interface TextSpec {
  text: string;
  style: GeistStyle;
  italic: boolean;
  size: number;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fill: string;
  /** Apply the font's pair kerning: the print heading does, score text does not. */
  kerned?: boolean;
}

class Writer {
  /** Code points used, per defs prefix. */
  readonly used = new Map<string, { table: GlyphTable; codepoints: Set<number> }>();
  readonly masks: string[] = [];
  fallbackTexts = 0;
  missingGlyphs = 0;

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
    if (!glyphs[String(codepoint)]) {
      this.missingGlyphs++;
      return '';
    }
    const k = size / unitsPerEm;
    const href = this.mark('b', glyphs, codepoint);
    return `<use xlink:href="${href}" transform="translate(${num(x)} ${num(y)}) scale(${scale(k)} ${scale(-k)})" fill="${fill}"/>`;
  }

  /** Text as outlines; `undefined` when a character is missing, so the caller falls back. */
  private outlined(t: TextSpec): string | undefined {
    const { geist } = this.outlines;
    const table = geist.styles[t.style];
    const run = textRun(t.text, table, t.kerned ? geist.kern[t.style] : undefined);
    if (run.missing) return undefined;
    const k = t.size / geist.unitsPerEm;
    const shift = t.anchor === 'middle' ? run.width / 2 : t.anchor === 'end' ? run.width : 0;
    const uses = run.chars
      .filter(({ codepoint }) => (table[String(codepoint)]?.d ?? '') !== '')
      .map(({ codepoint, x: pen }) => {
        const href = this.mark(`g${t.style}`, table, codepoint);
        return `<use xlink:href="${href}"${pen === 0 ? '' : ` x="${String(pen)}"`}/>`;
      });
    if (uses.length === 0) return '';
    // Font units are y up: x' = x + skew * (height above the baseline).
    const matrix = t.italic
      ? `matrix(${scale(k)} 0 ${scale(k * ITALIC_SKEW)} ${scale(-k)} ${num(t.x - shift * k)} ${num(t.y)})`
      : `translate(${num(t.x - shift * k)} ${num(t.y)}) scale(${scale(k)} ${scale(-k)})`;
    return `<g transform="${matrix}" fill="${t.fill}">${uses.join('')}</g>`;
  }

  private fallbackText(t: TextSpec): string {
    this.fallbackTexts++;
    const weight = t.style === '600' ? ' font-weight="600"' : '';
    const slant = t.italic ? ' font-style="italic"' : '';
    const textAnchor = t.anchor === 'start' ? '' : ` text-anchor="${t.anchor}"`;
    return `<text x="${num(t.x)}" y="${num(t.y)}" font-family="${FALLBACK_FAMILY}" font-size="${num(t.size)}"${weight}${slant}${textAnchor} fill="${t.fill}" xml:space="preserve">${escapeXml(t.text)}</text>`;
  }

  text(t: TextSpec): string {
    return this.outlined(t) ?? this.fallbackText(t);
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
  // A transparent image has no paper to match: the box only cuts (the mask), it draws nothing.
  if (p.role === 'paper' && background === 'transparent') return '';
  const colour = roleColour(p.role);
  switch (p.kind) {
    case 'glyph':
      return writer.glyph(p.x, p.y, p.size, p.codepoint, colour);
    case 'text':
      return writer.text({
        text: p.text,
        style: '400',
        italic: p.italic,
        size: p.size,
        x: p.x,
        y: p.y,
        anchor: p.anchor,
        fill: colour,
      });
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

type PathPrimitive = Extract<Primitive, { kind: 'path' }>;

/** The paper boxes of a system, in draw order: filled paths of role `paper`. */
function isBox(p: Primitive): p is PathPrimitive {
  return p.kind === 'path' && p.role === 'paper' && p.fill;
}

/**
 * The system's primitives; on a transparent background each line is cut by the boxes drawn after
 * it that overlap it, through a mask no larger than the line's own extent.
 */
function systemBody(
  writer: Writer,
  primitives: readonly Primitive[],
  background: ImageBackground,
  maskPrefix: string,
): string {
  // Walking backwards, the boxes seen so far are exactly those drawn after the current primitive.
  const later: (readonly PathPrimitive[] | undefined)[] = [];
  if (background === 'transparent') {
    const boxes: PathPrimitive[] = [];
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
  return primitives
    .map((p, i) => {
      let maskId: string | undefined;
      const cuts = later[i];
      if (cuts && cuts.length > 0 && p.kind === 'line') {
        // Padded by the stroke width so its caps are not cut, and by a margin for rounding.
        const pad = p.thickness + MASK_PAD;
        const region: Rect = {
          x: p.bbox.x - pad,
          y: p.bbox.y - pad,
          width: p.bbox.width + 2 * pad,
          height: p.bbox.height + 2 * pad,
        };
        const key = `${[region.x, region.y, region.width, region.height].map(num).join(' ')}|${cuts.map((box) => box.d).join('|')}`;
        maskId = maskIds.get(key);
        if (!maskId) {
          maskId = `${maskPrefix}${String(maskIds.size)}`;
          maskIds.set(key, maskId);
          const area = `x="${num(region.x)}" y="${num(region.y)}" width="${num(region.width)}" height="${num(region.height)}"`;
          const holes = cuts.map((box) => `<path d="${box.d}" fill="#000000"/>`).join('');
          writer.masks.push(
            `<mask id="${maskId}" maskUnits="userSpaceOnUse" ${area}><rect ${area} fill="#ffffff"/>${holes}</mask>`,
          );
        }
      }
      return primitiveSvg(writer, p, background, maskId);
    })
    .join('');
}

/**
 * Cuts a string to fit `max` px with a trailing ellipsis, like `text-overflow: ellipsis`: nothing
 * when not even the ellipsis fits. A character with no outline counts one em wide, so a CJK or
 * Hebrew title that falls back to `<text>` is cut too, if only roughly.
 */
function fitted(
  text: string,
  style: GeistStyle,
  size: number,
  max: number,
  outlines: Outlines,
): string {
  const { geist } = outlines;
  const table = geist.styles[style];
  const kern = geist.kern[style];
  const k = size / geist.unitsPerEm;
  const widthOf = (value: string): number => {
    const run = textRun(value, table, kern);
    const unknown = Array.from(value).filter((c) => !table[String(c.codePointAt(0))]).length;
    return run.width * k + unknown * UNKNOWN_ADVANCE_EM * size;
  };
  const room = max + 1e-6;
  if (widthOf(text) <= room) return text;
  const characters = Array.from(text);
  while (characters.length > 0 && widthOf(characters.join('') + ELLIPSIS) > room) characters.pop();
  const cut = characters.join('').trimEnd();
  if (widthOf(cut + ELLIPSIS) > room) return '';
  return cut + ELLIPSIS;
}

/**
 * The print heading's text is centred in HTML with the browser's default kerning, so it is
 * measured and drawn with the font's pair kerning (score text, which layout measured, has none).
 * Ligatures and kerning beyond printable ASCII pairs are not applied.
 */
function headerSvg(writer: Writer, heading: PrintHeading, page: Page, outlines: Outlines): string {
  const width = page.bbox.width - margins.left - margins.right;
  const centre = margins.left + width / 2;
  const { ascent, descent } = outlines.geist;
  const rows: string[] = [];
  let top = margins.top;
  const row = (text: string, style: GeistStyle, size: number, line: number, fill: string): void => {
    const cut = fitted(text, style, size, width, outlines);
    const baseline = top + (line - ((ascent + descent) / 1000) * size) / 2 + (ascent / 1000) * size;
    if (cut !== '') {
      rows.push(
        writer.text({
          text: cut,
          style,
          italic: false,
          size,
          x: centre,
          y: baseline,
          anchor: 'middle',
          fill,
          kerned: true,
        }),
      );
    }
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

/** The standalone SVG of one page, with what fell back on the way. Deterministic. */
export function pageSvgReport(input: PageSvgInput): PageSvgReport {
  const { layout, page, outlines, background, heading, title } = input;
  const crop = input.crop ?? { x: 0, y: 0, width: page.bbox.width, height: page.bbox.height };
  const writer = new Writer(outlines);
  const body: string[] = [];

  layout.systems.slice(page.systems.start, page.systems.end).forEach((system, index) => {
    // Primitives are in the system's own frame (continuous segments are shifted by `offsetX`).
    const dx = (system.offsetX ?? 0) - page.bbox.x - crop.x;
    const dy = -page.bbox.y - crop.y;
    const primitives = layout.primitives.slice(system.primitives.start, system.primitives.end);
    // The page in the id keeps two pages' masks apart when their SVGs share one document.
    const inner = systemBody(
      writer,
      primitives,
      background,
      `p${String(page.index)}m${String(index)}-`,
    );
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
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `${titleTag}<defs>${writer.defs()}</defs>\n${rect}${body.join('\n')}\n</svg>\n`;
  return { svg, fallbackTexts: writer.fallbackTexts, missingGlyphs: writer.missingGlyphs };
}

/** The standalone SVG of one page. */
export function pageSvg(input: PageSvgInput): string {
  return pageSvgReport(input).svg;
}
