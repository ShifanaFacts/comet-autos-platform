'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { prepareImage } from '@/lib/team/client';

/**
 * Photos to send with a task or a note: the camera on a phone, a picker on
 * a computer, thumbnails to check, and a cross to drop one. Nothing is sent
 * until the form is saved.
 */
export function PhotoPicker({
  files,
  onChange,
  max = 6,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Previews for the chosen photos, let go of when the choice changes.
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    const room = Math.max(0, max - files.length);
    const prepared = await Promise.all(Array.from(list).slice(0, room).map(prepareImage));
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
    onChange([...files, ...prepared]);
  }

  const full = files.length >= max;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Take a photo"
        onChange={(event) => add(event.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="sr-only"
        aria-label="Choose photos"
        onChange={(event) => add(event.target.files)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={full}
          onClick={() => cameraRef.current?.click()}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted disabled:opacity-50 pointer-fine:hidden"
        >
          <Camera className="size-4" />
          Take photo
        </button>
        <button
          type="button"
          disabled={full}
          onClick={() => galleryRef.current?.click()}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <ImagePlus className="size-4" />
          {files.length ? 'Add more' : 'Add photos'}
        </button>
        {files.length ? (
          <span className="self-center text-xs text-muted-foreground">
            {files.length} of {max}
          </span>
        ) : null}
      </div>
      {urls.length ? (
        <ul className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <li key={url} className="relative size-20 overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-full object-cover" />
              <button
                type="button"
                aria-label="Remove this photo"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
