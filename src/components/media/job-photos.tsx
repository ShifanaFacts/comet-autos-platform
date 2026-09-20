'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ChevronLeft, ChevronRight, ImageOff, Loader2, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MediaStage } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, NativeSelect } from '@/components/forms/fields';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { MEDIA_STAGE_LABEL, MEDIA_STAGES } from '@/lib/media/stages';
import { cn } from '@/lib/utils';
import { removePhotoAction } from '@/app/(app)/job-cards/[id]/actions';

export interface PhotoItem {
  id: string;
  stage: MediaStage;
  description: string | null;
  createdAt: string;
  uploadedBy: string;
}

/** Ask any "Add photo" button on the page to open the camera/gallery picker. */
export const ADD_PHOTO_EVENT = 'comet:add-photo';

const MAX_EDGE = 2400;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** Shrinks large photos on the device before upload: faster on workshop Wi-Fi, lighter to view later. */
async function prepare(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // The server checks the actual bytes and explains if it can't take the file.
  }
}

function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function JobPhotos({
  jobCardId,
  photos,
  defaultStage,
  canEdit,
}: {
  jobCardId: string;
  photos: PhotoItem[];
  defaultStage: MediaStage;
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<MediaStage | 'ALL'>('ALL');
  const [picked, setPicked] = useState<{ file: File; url: string }[]>([]);
  const [stage, setStage] = useState<MediaStage>(defaultStage);
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [isRemoving, startRemoving] = useTransition();

  useEffect(() => {
    function open() {
      inputRef.current?.click();
    }
    window.addEventListener(ADD_PHOTO_EVENT, open);
    return () => window.removeEventListener(ADD_PHOTO_EVENT, open);
  }, []);

  const counts = useMemo(() => {
    const map = new Map<MediaStage, number>();
    for (const photo of photos) map.set(photo.stage, (map.get(photo.stage) ?? 0) + 1);
    return map;
  }, [photos]);
  const shown = filter === 'ALL' ? photos : photos.filter((photo) => photo.stage === filter);
  const VISIBLE = 8;

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const prepared = await Promise.all(Array.from(files).slice(0, 12).map(prepare));
    setPicked(prepared.map((file) => ({ file, url: URL.createObjectURL(file) })));
    setStage(defaultStage);
    setCaption('');
    setUploadError(null);
    requestKey.current = newKey();
    if (inputRef.current) inputRef.current.value = '';
  }

  function closeUpload() {
    if (progress !== null) return;
    picked.forEach((p) => URL.revokeObjectURL(p.url));
    setPicked([]);
  }

  function upload() {
    if (progress !== null || picked.length === 0) return;
    const form = new FormData();
    picked.forEach((p) => form.append('photos', p.file));
    form.set('stage', stage);
    form.set('description', caption);
    form.set('requestKey', requestKey.current ?? newKey());
    setUploadError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/job-cards/${jobCardId}/photos`);
    xhr.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () => {
      setProgress(null);
      setUploadError('The upload didn’t reach the workshop system — nothing was saved. Check the connection and try again.');
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { ok?: boolean; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) {
        toast.success(`${picked.length} photo${picked.length === 1 ? '' : 's'} added to ${MEDIA_STAGE_LABEL[stage]}`);
        picked.forEach((p) => URL.revokeObjectURL(p.url));
        setPicked([]);
        requestKey.current = null;
        setFilter('ALL');
        router.refresh();
      } else {
        setUploadError(body.error ?? 'The photos could not be saved. Nothing was saved — please try again.');
      }
    };
    xhr.send(form);
  }

  const current = viewer !== null ? shown[viewer] : null;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="sr-only"
        aria-label="Choose photos"
        onChange={(event) => onPick(event.target.files)}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          {[{ key: 'ALL' as const, label: 'All', count: photos.length }, ...MEDIA_STAGES.filter((s) => counts.get(s.stage)).map((s) => ({ key: s.stage, label: s.label, count: counts.get(s.stage) ?? 0 }))].map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              aria-pressed={filter === chip.key}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                filter === chip.key ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground/80 hover:bg-muted',
              )}
            >
              {chip.label}
              <span className={cn('tabular-nums', filter === chip.key ? 'text-background/70' : 'text-muted-foreground')}>{chip.count}</span>
            </button>
          ))}
        </div>
        {canEdit ? (
          <Button variant="outline" className="h-10 shrink-0" onClick={() => inputRef.current?.click()}>
            <Camera />
            Add photos
          </Button>
        ) : null}
      </div>

      {photos.length === 0 ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center transition-colors enabled:hover:bg-muted/40"
        >
          <Camera className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">No photos yet</span>
          <span className="max-w-sm text-xs text-muted-foreground">
            {canEdit ? 'Photograph the vehicle at intake, and the work as it happens — they are kept with this job.' : 'Photos added to this job appear here.'}
          </span>
        </button>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-4 2xl:grid-cols-6">
          {shown.slice(0, VISIBLE).map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setViewer(index)}
                className="group relative block aspect-square w-full overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={`${MEDIA_STAGE_LABEL[photo.stage]} photo${photo.description ? `: ${photo.description}` : ''}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/${photo.id}`} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] font-medium text-white">
                  {MEDIA_STAGE_LABEL[photo.stage]}
                </span>
              </button>
            </li>
          ))}
          {shown.length > VISIBLE ? (
            <li>
              <button
                type="button"
                onClick={() => setViewer(VISIBLE)}
                className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground hover:bg-muted/70"
              >
                +{shown.length - VISIBLE} more
              </button>
            </li>
          ) : null}
        </ul>
      )}

      {/* Upload sheet */}
      <Dialog open={picked.length > 0} onOpenChange={(open) => !open && closeUpload()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Add {picked.length} photo{picked.length === 1 ? '' : 's'}
            </DialogTitle>
            <DialogDescription>They are saved with this job and can be seen by the team.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {picked.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.url} src={p.url} alt="" className="aspect-square w-full rounded-md object-cover" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stage" htmlFor="photo-stage">
              <NativeSelect id="photo-stage" value={stage} onChange={(event) => setStage(event.target.value as MediaStage)} className="h-11 text-base md:text-sm">
                {MEDIA_STAGES.map((s) => (
                  <option key={s.stage} value={s.stage}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Caption" htmlFor="photo-caption" hint="Optional">
              <input
                id="photo-caption"
                value={caption}
                maxLength={300}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="e.g. Scratch on rear bumper"
                className="h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            </Field>
          </div>
          {progress !== null ? (
            <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{progress < 100 ? `Uploading… ${progress}%` : 'Saving…'}</span>
            </div>
          ) : null}
          {uploadError ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              {uploadError}
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="h-12 text-base sm:h-11 sm:text-sm" onClick={upload} disabled={progress !== null}>
              {progress !== null ? <Loader2 className="animate-spin" /> : <Upload />}
              {progress !== null ? 'Uploading…' : `Save ${picked.length} photo${picked.length === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" className="h-12 sm:h-11" onClick={closeUpload} disabled={progress !== null}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Viewer */}
      <Dialog open={current !== null} onOpenChange={(open) => !open && setViewer(null)}>
        <DialogContent className="max-w-3xl gap-3 p-3 sm:p-4" showCloseButton={false}>
          {current ? (
            <>
              <DialogTitle className="sr-only">{MEDIA_STAGE_LABEL[current.stage]} photo</DialogTitle>
              <div className="relative flex items-center justify-center overflow-hidden rounded-md bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/${current.id}`} alt={current.description ?? `${MEDIA_STAGE_LABEL[current.stage]} photo`} className="max-h-[70dvh] w-auto object-contain" />
                <button
                  type="button"
                  onClick={() => setViewer(null)}
                  aria-label="Close"
                  className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X className="size-5" />
                </button>
                {viewer! > 0 ? (
                  <button type="button" onClick={() => setViewer(viewer! - 1)} aria-label="Previous photo" className="absolute left-2 flex size-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <ChevronLeft className="size-6" />
                  </button>
                ) : null}
                {viewer! < shown.length - 1 ? (
                  <button type="button" onClick={() => setViewer(viewer! + 1)} aria-label="Next photo" className="absolute right-2 flex size-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <ChevronRight className="size-6" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 px-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {MEDIA_STAGE_LABEL[current.stage]}
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {viewer! + 1} of {shown.length}
                    </span>
                  </p>
                  {current.description ? <p className="text-sm">{current.description}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    Added by {current.uploadedBy} · {current.createdAt}
                  </p>
                </div>
                {canEdit ? (
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive" disabled={isRemoving}>
                        <Trash2 />
                        Remove
                      </Button>
                    }
                    title="Remove this photo from the job?"
                    description="It will no longer show on the job card. The removal is recorded with your name."
                    confirmLabel="Remove photo"
                    onConfirm={async () =>
                      startRemoving(async () => {
                        const result = await removePhotoAction(jobCardId, current.id);
                        if (!result.ok) {
                          toast.error(result.error ?? 'The photo could not be removed.');
                          return;
                        }
                        toast.success('Photo removed');
                        setViewer(null);
                        router.refresh();
                      })
                    }
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <ImageOff className="size-6" />
              Photo not available
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
