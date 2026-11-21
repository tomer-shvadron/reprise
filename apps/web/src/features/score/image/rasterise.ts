import { withDpi } from './png';

export interface RasteriseOptions {
  /** The SVG's size in px, at 96 dpi. */
  width: number;
  height: number;
  scale: number;
}

export type Rasterise = (svg: string, options: RasteriseOptions) => Promise<Uint8Array>;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunks keep `String.fromCharCode` under the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * One page SVG as a PNG, in the browser. It goes through an `<img>` on a `data:` URL, which the
 * CSP's `img-src` allows (`blob:` it does not). The SVG is outlined, so no font has to load, and
 * the canvas starts transparent: white paper is already in the SVG.
 */
export const svgToPng: Rasterise = async (svg, { width, height, scale }) => {
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${toBase64(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('the browser gave no 2D canvas');
    // Drawn at the target size, an SVG image is rasterised there, not scaled from 1x.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((made) => {
        if (made) resolve(made);
        else reject(new Error('the canvas made no PNG'));
      }, 'image/png');
    });
    return withDpi(new Uint8Array(await blob.arrayBuffer()), 96 * scale);
  } finally {
    // A 3x page is about 32 MB of pixels; release it before the next.
    canvas.width = 0;
    canvas.height = 0;
  }
};
