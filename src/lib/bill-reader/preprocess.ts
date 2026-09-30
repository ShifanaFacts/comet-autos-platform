/*
 * Cleaning a photo of a bill before it is read.
 *
 * A phone photo is coloured, unevenly lit and either far bigger or smaller
 * than the reader wants. OCR reads dark text on a light, even ground at
 * about 30 pixels a line best, so: grey, stretched to the full black-to-white
 * range, and sharpened. Pure functions over pixel arrays, so they can be
 * tested without a browser; `prepareImage` is the browser wrapper.
 */

export const TARGET_WIDTH = 1800;

export interface Pixels {
  /** RGBA, four bytes a pixel. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Luminance of each pixel (what the eye sees as its brightness), one byte each. */
export function toGrey({ data, width, height }: Pixels): Uint8ClampedArray {
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < grey.length; i += 4, p += 1) {
    grey[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return grey;
}

/**
 * Stretches the greys so the darkest 1% become black and the lightest 1%
 * white: a dim photo of thermal paper comes out as ink on paper. The 1%
 * ignores a few stray specks or a glare spot at either end.
 */
export function normaliseContrast(grey: Uint8ClampedArray): Uint8ClampedArray {
  const histogram = new Uint32Array(256);
  for (const value of grey) histogram[value] += 1;
  const cut = grey.length * 0.01;
  let low = 0;
  for (let seen = 0; low < 255 && (seen += histogram[low]) < cut; low += 1);
  let high = 255;
  for (let seen = 0; high > 0 && (seen += histogram[high]) < cut; high -= 1);
  if (high - low < 10) return grey;
  const scale = 255 / (high - low);
  const out = new Uint8ClampedArray(grey.length);
  for (let p = 0; p < grey.length; p += 1) out[p] = (grey[p] - low) * scale;
  return out;
}

/** A light sharpen (centre 5, neighbours −1): crisper edges on small print. */
export function sharpen(grey: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grey);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      out[p] = 5 * grey[p] - grey[p - 1] - grey[p + 1] - grey[p - width] - grey[p + width];
    }
  }
  return out;
}

/** Grey, contrast and sharpen, written back as RGBA. */
export function cleanPixels(pixels: Pixels): Pixels {
  const grey = sharpen(normaliseContrast(toGrey(pixels)), pixels.width, pixels.height);
  const data = new Uint8ClampedArray(pixels.data.length);
  for (let p = 0, i = 0; p < grey.length; p += 1, i += 4) {
    data[i] = data[i + 1] = data[i + 2] = grey[p];
    data[i + 3] = 255;
  }
  return { data, width: pixels.width, height: pixels.height };
}

/** The size to draw at: about TARGET_WIDTH wide, never enlarged more than twice. */
export function targetSize(width: number, height: number) {
  const scale = Math.min(TARGET_WIDTH / width, 2);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Browser only: a photo (or a rendered PDF page) as a cleaned canvas, ready to read. */
export async function prepareImage(source: Blob): Promise<HTMLCanvasElement> {
  // `from-image` applies the phone's rotation flag, so a portrait photo is upright.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const size = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser can’t prepare images.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const image = context.getImageData(0, 0, size.width, size.height);
  const cleaned = cleanPixels(image);
  context.putImageData(
    new ImageData(cleaned.data as Uint8ClampedArray<ArrayBuffer>, size.width, size.height),
    0,
    0,
  );
  return canvas;
}
