/** The page count and each page's MediaBox of a PDF whose page dictionaries are not compressed. */
export interface PdfPages {
  count: number;
  /** Width and height in points, page by page. */
  mediaBoxes: [number, number][];
}

/**
 * Reads the page objects of a PDF as Chromium's Skia writes them: page dictionaries in plain
 * objects, outside any object stream. `/Type /Pages` (the tree's nodes) is not a page.
 */
export function pdfPages(bytes: Uint8Array): PdfPages {
  const text = new TextDecoder('latin1').decode(bytes);
  const mediaBoxes: [number, number][] = [];
  for (const object of text.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g)) {
    const body = object[1] ?? '';
    if (!/\/Type\s*\/Page(?![s\w])/.test(body)) continue;
    const box = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(body);
    if (!box) throw new Error('a page without its own MediaBox');
    const [x0, y0, x1, y1] = box.slice(1, 5).map(Number);
    mediaBoxes.push([(x1 ?? 0) - (x0 ?? 0), (y1 ?? 0) - (y0 ?? 0)]);
  }
  if (/\/Type\s*\/ObjStm\b/.test(text) && mediaBoxes.length === 0) {
    throw new Error('the pages are in object streams, which this reader does not decompress');
  }
  return { count: mediaBoxes.length, mediaBoxes };
}
