/**
 * The export runner: settings to a layout, pages, files, and one file or one zip. It never touches
 * the document, so an export is not a save: `dirty`, the handle and `songId` stay as they were.
 *
 * Layout is the print pass (paged, the chosen paper, zoom 1, light colours), so an exported page
 * is what Print paints. A bar range is cut out with `sliceScore`, laid out without the heading on
 * 24 px margins and cropped to its content.
 */
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import {
  layout as layoutScore,
  type LayoutOptions,
  type LayoutResult,
  type Page,
} from '@reprise/layout';
import type { Id, Notation, Score } from '@reprise/model';

import { safeName } from '@/features/library/import/safe-name';
import type { FileFilter } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';

import { loadOutlines, type Outlines } from './outlines';
import { svgToPng, type Rasterise } from './rasterise';
import { clampRange, sliceScore } from './slice-score';
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
  /** The view's settings, as Print takes them; left out, layout's defaults. */
  tiedNotes?: LayoutOptions['tiedNotes'];
  chordDiagrams?: boolean;
  /** The chord strip under the title (#352); a bar range has no title, so none either. */
  chordStrip?: boolean;
  /** The track current on screen, which the strip prefers when it is drawn. */
  currentTrack?: Id | undefined;
}

export interface ImageExportDeps {
  platform: Pick<Platform, 'saveFile'>;
  /** `loadOutlines` unless given. */
  outlines?: () => Promise<Outlines>;
  /** `svgToPng` unless given. */
  rasterise?: Rasterise;
  /** Resolves when the UI has had a turn; tests pass `Promise.resolve`. */
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

/**
 * Gives the UI its turn between pages. A `MessageChannel` message is a macrotask that is neither
 * held until a frame (`requestAnimationFrame` stalls in a hidden or occluded window and costs a
 * frame per page) nor throttled like a background timer.
 */
function afterTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
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
  const content = {
    ...(request.tiedNotes !== undefined && { tiedNotes: request.tiedNotes }),
    ...(request.chordDiagrams !== undefined && { chordDiagrams: request.chordDiagrams }),
  };
  const printContent = {
    ...content,
    ...(request.chordStrip && { chordStrip: true, currentTrack: request.currentTrack }),
  };
  const settings: PrintSettings = { tracks: [...tracks], paper, header: true, pageNumbers: false };
  if (scope.kind === 'bars') {
    const range = clampRange(score, scope.start, scope.end);
    const sliced = sliceScore(score, range.start, range.end);
    const present = new Set(sliced.tracks.map(({ id }) => id));
    const kept = {
      ...settings,
      header: false,
      tracks: settings.tracks.filter((id) => present.has(id)),
    };
    const options = {
      ...printLayoutOptions(kept, notation, 0, content),
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
      label: `bars ${String(range.start + 1)}-${String(range.end)}`,
    };
  }
  const { result, heading } = layoutForPrint(score, settings, notation, fileName, printContent);
  const all = result.pages.map((page, i) => ({ page, number: i + 1 }));
  if (scope.kind === 'page') {
    const wanted = Math.min(Math.max(1, Math.round(scope.page)), all.length);
    return { result, heading, pages: all.slice(wanted - 1, wanted), label: '' };
  }
  return { result, heading, pages: all, label: '' };
}

export interface PreparedImages {
  pageCount: number;
  /** What the saved file is called: the image itself, or the zip of several. */
  fileName: string;
  /** Renders each page in order and hands it over; nothing is kept here. */
  run: (onImage: (image: ExportedImage) => void) => Promise<{ fallbackTexts: number }>;
}

/** Lays the request out and names its files; `run` then renders page by page. */
export async function prepareImages(
  request: ImageExportRequest,
  deps: Omit<ImageExportDeps, 'platform'>,
): Promise<PreparedImages> {
  const { signal, onProgress } = deps;
  const outlines = await (deps.outlines ?? loadOutlines)();
  const rasterise = deps.rasterise ?? svgToPng;
  const yieldFrame = deps.yieldFrame ?? afterTask;
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  throwIfAborted();

  const plan = planOf(request);
  const { format, scale } = request;
  const base = baseName(request.score, request.fileName);
  const stem = plan.label ? `${base} ${plan.label}` : base;
  const suffix = format === 'png' && scale > 1 ? `@${String(scale)}x` : '';
  // Padded to the layout's page count, so page 7 of 64 is `p07` whether it is alone or in a zip.
  const digits = String(plan.result.pages.length).length;
  const total = plan.pages.length;
  const single = total === 1;
  // A page of a whole-score export is `p01`; a lone page keeps its number so it names itself.
  const nameOf = ({ number }: { number: number }): string =>
    `${stem}${single && request.scope.kind !== 'page' ? '' : ` p${pad(number, digits)}`}${suffix}.${format}`;

  return {
    pageCount: total,
    fileName: single ? nameOf(plan.pages[0] ?? { number: 1 }) : `${stem} (${format}${suffix}).zip`,
    run: async (onImage) => {
      let fallbackTexts = 0;
      for (const [i, item] of plan.pages.entries()) {
        throwIfAborted();
        onProgress?.({ done: i, total });
        const crop = plan.crop?.(item.page, plan.result);
        const report = pageSvgReport({
          layout: plan.result,
          page: item.page,
          outlines,
          background: request.background,
          heading: plan.heading,
          title: request.score.meta.title.trim() || undefined,
          ...(crop && { crop }),
        });
        fallbackTexts += report.fallbackTexts;
        const width = crop?.width ?? item.page.bbox.width;
        const height = crop?.height ?? item.page.bbox.height;
        const bytes =
          format === 'svg'
            ? new TextEncoder().encode(report.svg)
            : await rasterise(report.svg, { width, height, scale });
        onImage({ name: nameOf(item), bytes, width, height });
        await yieldFrame();
      }
      throwIfAborted();
      onProgress?.({ done: total, total });
      return { fallbackTexts };
    },
  };
}

/** The images of a request, in page order, all in memory: for Copy as image and for tests. */
export async function renderImages(
  request: ImageExportRequest,
  deps: Omit<ImageExportDeps, 'platform'>,
): Promise<RenderedImages> {
  const { fileName, run } = await prepareImages(request, deps);
  const images: ExportedImage[] = [];
  const { fallbackTexts } = await run((image) => images.push(image));
  return { images, fileName, fallbackTexts };
}

/**
 * A zip built as pages arrive, so the PNGs are not all held and then zipped again: each entry is
 * pushed to fflate's streaming `Zip` and only the zip's own chunks stay. PNGs are stored (they are
 * deflated already), SVGs compressed.
 */
function zipSink(format: ImageFormat): {
  add: (image: ExportedImage) => void;
  finish: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });
  return {
    add: ({ name, bytes }) => {
      const file = format === 'png' ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
      zip.add(file);
      file.push(bytes, true);
    },
    finish: () => {
      zip.end();
      if (failure) throw failure;
      const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let at = 0;
      // Dropping each chunk as it is copied keeps the second copy from doubling the peak.
      for (const [i, chunk] of chunks.entries()) {
        out.set(chunk, at);
        at += chunk.length;
        chunks[i] = new Uint8Array(0);
      }
      return out;
    },
  };
}

/**
 * Renders and saves: one image as a plain file, several as one zip, through one save dialog.
 * A cancel mid-run, by `signal` or by closing the dialog, writes nothing.
 */
export async function exportImages(
  request: ImageExportRequest,
  deps: ImageExportDeps,
): Promise<ImageExportResult> {
  let bytes: Uint8Array | undefined;
  let fileName = '';
  let files = 0;
  let fallbackTexts = 0;
  try {
    const prepared = await prepareImages(request, deps);
    fileName = prepared.fileName;
    const sink = prepared.pageCount > 1 ? zipSink(request.format) : undefined;
    const run = await prepared.run((image) => {
      files++;
      if (sink) sink.add(image);
      else bytes = image.bytes;
    });
    fallbackTexts = run.fallbackTexts;
    if (sink) bytes = sink.finish();
  } catch (error) {
    if (error instanceof ExportCancelled) return { status: 'cancelled' };
    throw error;
  }
  if (!bytes) throw new Error('the export made no image');
  const filter = files === 1 ? IMAGE_FILTERS[request.format] : IMAGE_FILTERS.zip;
  const path = await deps.platform.saveFile(fileName, bytes, [filter]);
  return { status: 'saved', path, files, fallbackTexts };
}
