import { prepareImage } from '@/lib/bill-reader/preprocess';

/*
 * Reading a photo of a bill, in the browser.
 *
 * Tesseract runs in a web worker on the user's own device: the image never
 * leaves it, there is no outside service and nothing to pay for. The engine
 * and the English and Arabic language data are served by this app from
 * /tesseract (copied there by `npm install`), so it works with the site's
 * strict content policy and on a workshop connection with no CDN access.
 *
 * Two passes, not one. Loading Arabic next to English makes Tesseract drop
 * digits from long numbers — a TRN ending "0003" comes back as "3", an
 * invoice number "1042-558812" as "1042-2" — and those are exactly the
 * fields that must be right. So the numbers and the English wording are
 * read with English alone; Arabic is a second pass, run only when the first
 * found no "Tax Invoice" in English, and only its Arabic words are kept.
 */

const ASSETS = '/tesseract';

/** 0–1, and what is happening, for the "Reading the bill…" bar. */
export type Progress = (fraction: number, step: string) => void;

const ARABIC = /[\u0600-\u06ff]/;

async function recognise(
  languages: string[],
  canvas: HTMLCanvasElement,
  onProgress: Progress,
  from: number,
  to: number,
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  // 1 = the LSTM engine only: the one the self-hosted core and data are for.
  const worker = await createWorker(languages, 1, {
    workerPath: `${ASSETS}/worker.min.js`,
    corePath: ASSETS,
    langPath: ASSETS,
    gzip: true,
    // A blob worker would need `worker-src blob:`; the policy allows 'self' only.
    workerBlobURL: false,
    logger: (message: { status: string; progress: number }) => {
      const reading = message.status === 'recognizing text';
      // Loading the engine is the first fifth of this pass; reading the rest.
      const within = reading ? 0.2 + message.progress * 0.8 : message.progress * 0.2;
      onProgress(
        from + within * (to - from),
        reading ? 'Reading the bill…' : 'Starting the reader…',
      );
    },
  });
  try {
    return (await worker.recognize(canvas)).data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * The Arabic wording of a mixed-language pass: only lines with Arabic
 * letters, and no digits at all, so nothing from this pass can put a wrong
 * number on the form.
 */
export function arabicWordsOnly(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => ARABIC.test(line))
    .map((line) => line.replace(/[\d\u0660-\u0669\u06f0-\u06f9]/g, ''))
    .join('\n');
}

/** The text on a photo (or any image) of a bill. */
export async function readImage(image: Blob, onProgress: Progress): Promise<string> {
  onProgress(0.02, 'Preparing the image…');
  const canvas = await prepareImage(image);
  const english = await recognise(['eng'], canvas, onProgress, 0.05, 0.9);
  if (/tax\s*invoice/i.test(english)) return english;
  // No English "Tax Invoice": it may only say so in Arabic (فاتورة ضريبية).
  const mixed = await recognise(['eng', 'ara'], canvas, onProgress, 0.9, 0.99);
  return `${english}\n${arabicWordsOnly(mixed)}`;
}

/** The first page of a scanned PDF as an image, to be read like a photo. */
export async function renderPdfPage(file: Blob): Promise<Blob> {
  const { renderPageAsImage } = await import('unpdf');
  const png = await renderPageAsImage(new Uint8Array(await file.arrayBuffer()), 1, { scale: 2 });
  return new Blob([png], { type: 'image/png' });
}
