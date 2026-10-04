/*
 * The browser half of saving a task or a note: one multipart request with
 * the text, photos and the voice note, with upload progress. Resolves rather
 * than rejects, so the form keeps everything for a retry.
 */

export { newRequestKey, prepareImage } from '@/lib/media/client';

export interface PostResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  ids?: string[];
}

export function postMultipart(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<PostResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (event) =>
      event.lengthComputable && onProgress?.(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () =>
      resolve({
        ok: false,
        error:
          'It didn’t reach the workshop system — nothing was saved. Check the connection and try again.',
      });
    xhr.onload = () => {
      let body: PostResult = { ok: false };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the generic message.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) return resolve(body);
      resolve({
        ok: false,
        error: body.error ?? 'It could not be saved. Nothing was saved — please try again.',
        fieldErrors: body.fieldErrors,
      });
    };
    xhr.send(form);
  });
}

/**
 * Splits what was said or typed into the task's first line (its title) and
 * the rest (its details). A long single sentence is cut at a word near 120
 * characters so the list stays readable; nothing is lost.
 */
export function splitTaskText(text: string): { title: string; details: string } {
  const value = text.trim();
  const newline = value.indexOf('\n');
  let title = newline === -1 ? value : value.slice(0, newline).trim();
  let details = newline === -1 ? '' : value.slice(newline + 1).trim();
  if (title.length > 160) {
    const cut = title.lastIndexOf(' ', 120);
    const at = cut > 40 ? cut : 120;
    details = `${title.slice(at).trim()}${details ? `\n${details}` : ''}`;
    title = `${title.slice(0, at).trim()}…`;
  }
  return { title, details };
}

/** "YYYY-MM-DD" n days from a calendar date, without time-zone drift. */
export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
