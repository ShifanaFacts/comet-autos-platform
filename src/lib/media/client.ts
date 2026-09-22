import type { MediaStage } from '@/generated/prisma/enums';

/*
 * The browser half of photo upload, shared by the job card's full gallery
 * and by the compact capture strip on each stage screen. Kept here so both
 * shrink, key and send photos in exactly the same way — and so a failure
 * reads the same wherever it happens.
 */

const MAX_EDGE = 2400;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/**
 * Shrinks large photos on the device before upload: faster on workshop
 * Wi-Fi, lighter to view later. A phone camera file is several megabytes
 * and nothing on screen needs that.
 */
export async function prepareImage(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // The server checks the actual bytes and explains if it can't take the file.
  }
}

/** A fresh key so a retried upload is recognised as the same submission. */
export function newRequestKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadResult {
  ok: boolean;
  /** Present when the upload failed — already phrased for the person holding the phone. */
  error?: string;
}

/**
 * Sends photos to the job's upload route with progress. Resolves rather
 * than rejects: the caller shows `error` in place and keeps everything the
 * person had picked, so a dropped connection costs a retry, not the work.
 */
export function sendPhotos(options: {
  jobCardId: string;
  files: File[];
  stage: MediaStage;
  description?: string;
  requestKey: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  const { jobCardId, files, stage, description, requestKey, signal, onProgress } = options;
  return new Promise((resolve) => {
    const form = new FormData();
    for (const file of files) form.append('photos', file);
    form.set('stage', stage);
    if (description) form.set('description', description);
    form.set('requestKey', requestKey);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/job-cards/${jobCardId}/photos`);
    xhr.upload.onprogress = (event) =>
      event.lengthComputable && onProgress?.(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () =>
      resolve({
        ok: false,
        error:
          'The upload didn’t reach the workshop system — nothing was saved. Check the connection and try again.',
      });
    xhr.onabort = () => resolve({ ok: false, error: 'The upload was cancelled.' });
    xhr.onload = () => {
      let body: { ok?: boolean; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the generic message below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) return resolve({ ok: true });
      resolve({
        ok: false,
        error: body.error ?? 'The photos could not be saved. Nothing was saved — please try again.',
      });
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
