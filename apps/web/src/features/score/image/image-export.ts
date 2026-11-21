/**
 * The export runner: settings to a layout, pages, files, and one file or one zip. It never touches
 * the document, so an export is not a save: `dirty`, the handle and `songId` stay as they were.
 *
 * Layout is the print pass (paged, the chosen paper, zoom 1, light colours), so an exported page
 * is what Print paints. A bar range is cut out with `sliceScore`, laid out without the heading on
 * 24 px margins and cropped to its content.
 */
import { zipSync, type Zippable } from 'fflate';

import { layout as layoutScore, type LayoutResult, type Page } from '@reprise/layout';
import type { Id, Notation, Score } from '@reprise/model';

import { safeName } from '@/features/library/import/safe-name';
import type { FileFilter } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';

import { loadOutlines, type Outlines } from './outlines';
import { svgToPng, type Rasterise } from './rasterise';
import { sliceScore } from './slice-score';
import { pageSvgReport, type ImageBackground } from './svg-page';
import { layoutForPrint, printLayoutOptions, type PrintSettings } from '../print-layout';
import type { PaperSize } from '../view-options';

export type ImageFormat = 'svg' | 'png';
export type ImageScale = 1 | 2 | 3;

export type ImageScope =
  | { kind: 'score' }
  /** 1-based, as the app counts pages. */
  | { kind: 'page'; page: number }
  /** Master bar indices, `end` exclusive. */
  | { kind: 'bars'; start: number; end: number };

export interface ImageExportRequest {
  score: Score;
  /** The library file's name, for a score with no title. */
  fileName?: string | undefined;
  scope: ImageScope;
  format: ImageFormat;
  /** PNG only. */
  scale: ImageScale;
  background: ImageBackground;
  paper: PaperSize;
  /**
   * The tracks to draw, in score order: the ones on screen, or for a selection the edit range's
   * tracks. The caller decides; the runner draws what it is given.
   */
  tracks: readonly Id[];
  notation: Record<Id, Notation>;
}

export interface ImageExportDeps {
  platform: Pick<Platform, 'saveFile'>;
  /** `loadOutlines` unless given. */
  outlines?: () => Promise<Outlines>;
  /** `svgToPng` unless given. */
  rasterise?: Rasterise;
  /** Resolves when the UI has had a frame; tests pass `Promise.resolve`. */
  yieldFrame?: () => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number }) => void;
}

export interface ExportedImage {
  /** The file's name, or its name inside the zip. */
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface RenderedImages {
  images: ExportedImage[];
  /** What the saved file is called: the image itself, or the zip of several. */
  fileName: string;
  /** Strings that went out as `<text>` because a character has no outline. */
  fallbackTexts: number;
}

export type ImageExportResult =
  | { status: 'saved'; path: string | undefined; files: number; fallbackTexts: number }
  | { status: 'cancelled' };

/** The margin around a bar range, and what it is cropped to. */
export const SELECTION_MARGIN = 24;

export const IMAGE_FILTERS = {
  svg: { name: 'SVG image', extensions: ['svg'] },
  png: { name: 'PNG image', extensions: ['png'] },
  zip: { name: 'ZIP archive', extensions: ['zip'] },
} as const satisfies Record<string, FileFilter>;

export class ExportCancelled extends Error {
  constructor() {
    super('the export was cancelled');
    this.name = 'ExportCancelled';
  }
}

function afterFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => {
        resolve();
      });
    else setTimeout(resolve, 0);
  });
}

function baseName(score: Score, fileName: string | undefined): string {
  const stem = (fileName ?? '').trim().replace(/\.[^./\\]+$/u, '');
  return safeName(score.meta.title.trim() || stem || 'Untitled');
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

interface Plan {
  result: LayoutResult;
  /** Pages to write, with their 1-based numbers. */
  pages: { page: Page; number: number }[];
  heading: ReturnType<typeof layoutForPrint>['heading'];
  /** Set for a bar range: the crop of each page. */
  crop?: (
    page: Page,
    result: LayoutResult,
  ) => { x: number; y: number; width: number; height: number };
  /** The part of the name after the base, e.g. `bars 12-16`. */
  label: string;
}

function planOf(request: ImageExportRequest): Plan {
  const { score, scope, paper, tracks, notation, fileName } = request;
  const settings: PrintSettings = { tracks: [...tracks], paper, header: true, pageNumbers: false };
  if (scope.kind === 'bars') {
    const sliced = sliceScore(score, scope.start, scope.end);
    const present = new Set(sliced.tracks.map(({ id }) => id));
    const kept = {
      ...settings,
      header: false,
      tracks: settings.tracks.filter((id) => present.has(id)),
    };
    const options = {
      ...printLayoutOptions(kept, notation, 0),
      margins: {
        top: SELECTION_MARGIN,
        right: SELECTION_MARGIN,
        bottom: SELECTION_MARGIN,
        left: SELECTION_MARGIN,
      },
    };
    const result = layoutScore(sliced, options);
    return {
      result,
      pages: result.pages.map((page, i) => ({ page, number: i + 1 })),
      heading: undefined,
      crop: (page, laid) => {
        const systems = laid.systems.slice(page.systems.start, page.systems.end);
        const bottom = Math.max(...systems.map((s) => s.bbox.y + s.bbox.height), page.bbox.y);
        const right = Math.max(...systems.map((s) => s.bbox.x + s.bbox.width), page.bbox.x);
        return {
          x: 0,
          y: 0,
          width: Math.min(page.bbox.width, right - page.bbox.x + SELECTION_MARGIN),
          height: Math.min(page.bbox.height, bottom - page.bbox.y + SELECTION_MARGIN),
        };
      },
      label: `bars ${String(scope.start + 1)}-${String(scope.end)}`,
    };
  }
  const { result, heading } = layoutForPrint(score, settings, notation, fileName);
  const all = result.pages.map((page, i) => ({ page, number: i + 1 }));
  if (scope.kind === 'page') {
    const wanted = Math.min(Math.max(1, Math.round(scope.page)), all.length);
    return { result, heading, pages: all.slice(wanted - 1, wanted), label: '' };
  }
  return { result, heading, pages: all, label: '' };
}

/** The images of a request, in page order, with the name to save them under. */
export async function renderImages(
  request: ImageExportRequest,
  deps: Omit<ImageExportDeps, 'platform'>,
): Promise<RenderedImages> {
  const { signal, onProgress } = deps;
  const outlines = await (deps.outlines ?? loadOutlines)();
  const rasterise = deps.rasterise ?? svgToPng;
  const yieldFrame = deps.yieldFrame ?? afterFrame;
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  throwIfAborted();

  const plan = planOf(request);
  const { format, scale } = request;
  const base = baseName(request.score, request.fileName);
  const stem = plan.label ? `${base} ${plan.label}` : base;
  const suffix = format === 'png' && scale > 1 ? `@${String(scale)}x` : '';
  const digits = String(plan.pages.length).length;
  const single = plan.pages.length === 1;
  const total = plan.pages.length;

  const images: ExportedImage[] = [];
  let fallbackTexts = 0;
  for (const [i, { page, number }] of plan.pages.entries()) {
    throwIfAborted();
    onProgress?.({ done: i, total });
    const crop = plan.crop?.(page, plan.result);
    const report = pageSvgReport({
      layout: plan.result,
      page,
      outlines,
      background: request.background,
      heading: plan.heading,
      title: request.score.meta.title.trim() || undefined,
      ...(crop && { crop }),
    });
    fallbackTexts += report.fallbackTexts;
    const width = crop?.width ?? page.bbox.width;
    const height = crop?.height ?? page.bbox.height;
    const bytes =
      format === 'svg'
        ? new TextEncoder().encode(report.svg)
        : await rasterise(report.svg, { width, height, scale });
    // A page of a whole-score export is `p01`; a lone page keeps its number so it names itself.
    const pageTag = single && request.scope.kind !== 'page' ? '' : ` p${pad(number, digits)}`;
    images.push({ name: `${stem}${pageTag}${suffix}.${format}`, bytes, width, height });
    await yieldFrame();
  }
  throwIfAborted();
  onProgress?.({ done: total, total });
  return {
    images,
    fileName: single
      ? (images[0]?.name ?? `${stem}.${format}`)
      : `${stem} (${format}${suffix}).zip`,
    fallbackTexts,
  };
}

/** Zips the images: PNGs stored, since they are deflated already, SVGs compressed. */
export function zipImages(images: readonly ExportedImage[], format: ImageFormat): Uint8Array {
  const entries: Zippable = {};
  for (const { name, bytes } of images)
    entries[name] = [bytes, { level: format === 'png' ? 0 : 6 }];
  return zipSync(entries);
}

/**
 * Renders and saves: one image as a plain file, several as one zip, through one save dialog.
 * A cancel mid-run, by `signal` or by closing the dialog, writes nothing.
 */
export async function exportImages(
  request: ImageExportRequest,
  deps: ImageExportDeps,
): Promise<ImageExportResult> {
  let rendered: RenderedImages;
  try {
    rendered = await renderImages(request, deps);
  } catch (error) {
    if (error instanceof ExportCancelled) return { status: 'cancelled' };
    throw error;
  }
  const { images, fileName, fallbackTexts } = rendered;
  const bytes =
    images.length === 1 && images[0] ? images[0].bytes : zipImages(images, request.format);
  const filter = images.length === 1 ? IMAGE_FILTERS[request.format] : IMAGE_FILTERS.zip;
  const path = await deps.platform.saveFile(fileName, bytes, [filter]);
  return { status: 'saved', path, files: images.length, fallbackTexts };
}
