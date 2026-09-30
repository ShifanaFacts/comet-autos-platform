'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, Info, Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import type { BillDraft, BillTarget } from '@/lib/bill-reader/read';
import { cn } from '@/lib/utils';

/*
 * The shared half of "Scan bill": pick a photo or PDF, read it, and hand the
 * expense or purchase screen a draft to open its form on.
 *
 * A photo is read on this device (Tesseract in a web worker); a PDF with a
 * text layer is read from that text by the server; a scanned PDF is drawn
 * here and read like a photo. Reading saves nothing — the file is only kept
 * in this page's memory until the user presses Save, and is attached then.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; progress: number; step: string }
  | { name: 'ready'; draft: BillDraft; file: File; previewUrl: string }
  | { name: 'error'; message: string };

interface ReadResponse {
  ok: boolean;
  error?: string;
  needsOcr?: boolean;
  draft?: BillDraft;
}

async function ask(
  target: BillTarget,
  part: { text: string } | { file: File },
): Promise<ReadResponse> {
  const form = new FormData();
  form.set('target', target);
  if ('text' in part) form.set('text', part.text);
  else form.set('file', part.file);
  const response = await fetch('/bill-reader/read', { method: 'POST', body: form });
  return (
    ((await response.json().catch(() => null)) as ReadResponse | null) ?? {
      ok: false,
      error: 'The bill could not be read. Check the connection and try again.',
    }
  );
}

export function useBillScan(target: BillTarget) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const previewUrl = phase.name === 'ready' ? phase.previewUrl : null;

  // The preview is a blob URL: released when it is replaced or the page goes.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const scan = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setPhase({ name: 'error', message: `“${file.name}” is larger than 10 MB.` });
        return;
      }
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf && !file.type.startsWith('image/')) {
        setPhase({
          name: 'error',
          message: 'Choose a photo (JPEG, PNG, WebP) or a PDF of the bill.',
        });
        return;
      }
      const progress = (fraction: number, step: string) =>
        setPhase({ name: 'reading', progress: fraction, step });
      progress(0.02, 'Reading the bill…');
      try {
        let answer: ReadResponse;
        if (isPdf) {
          answer = await ask(target, { file });
          if (answer.ok && answer.needsOcr) {
            // A scan inside a PDF: draw its first page and read it like a photo.
            const { readImage, renderPdfPage } = await import('@/lib/bill-reader/ocr');
            progress(0.04, 'Opening the PDF…');
            const text = await readImage(await renderPdfPage(file), progress);
            answer = await ask(target, { text });
          }
        } else {
          const { readImage } = await import('@/lib/bill-reader/ocr');
          const text = await readImage(file, progress);
          answer = await ask(target, { text });
        }
        if (!answer.ok || !answer.draft) {
          setPhase({ name: 'error', message: answer.error ?? 'The bill could not be read.' });
          return;
        }
        setPhase({
          name: 'ready',
          draft: answer.draft,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      } catch {
        setPhase({
          name: 'error',
          message:
            'The bill could not be read on this device. Try a clearer photo, or enter it by hand.',
        });
      }
    },
    [target],
  );

  const reset = useCallback(() => setPhase({ name: 'idle' }), []);
  return { phase, scan, reset };
}

/** The button, and the progress bar while a bill is being read. */
export function ScanBillButton({
  phase,
  onFile,
  size = 'lg',
  className,
}: {
  phase: Phase;
  onFile: (file: File) => void;
  size?: 'default' | 'lg';
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const reading = phase.name === 'reading';
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={reading}
        onClick={() => input.current?.click()}
        className="w-full sm:w-auto"
      >
        {reading ? <Loader2 className="animate-spin" /> : <ScanLine />}
        {reading ? 'Reading the bill…' : 'Scan bill'}
      </Button>
      {reading ? (
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-64">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(phase.progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{phase.step} Usually 3–6 seconds.</p>
        </div>
      ) : null}
      {phase.name === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}

/** The bill itself, beside the form (below it on a phone), for checking against. */
export function BillPreview({ file, previewUrl }: { file: File; previewUrl: string }) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">The bill</p>
      {isPdf ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm font-medium text-primary hover:underline"
        >
          <FileText className="size-5 shrink-0" />
          <span className="truncate">Open {file.name}</span>
        </a>
      ) : (
        <a href={previewUrl} target="_blank" rel="noreferrer" title="Open full size">
          {/* A blob preview of the user's own file: next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="The scanned bill"
            className="max-h-[70vh] w-full rounded-lg border border-border bg-muted/30 object-contain"
          />
        </a>
      )}
      <p className="text-xs text-muted-foreground">
        Kept with the record when you save. Nothing is saved until then.
      </p>
    </div>
  );
}

const amber = 'rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm';

/** What the reader found and what to watch for: duplicates, no TRN, sums that don't add up. */
export function BillNotices({ draft }: { draft: BillDraft }) {
  const reasons = [...new Set(draft.warnings.map((warning) => warning.message))];
  const figure = (label: string, field: 'subtotal' | 'vat' | 'total') => {
    const flagged = draft.warnings.some((warning) => warning.field === field);
    return (
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd
          className={cn(
            'rounded px-1.5 py-0.5 text-sm font-medium tabular-nums',
            flagged && 'outline outline-2 outline-warning',
          )}
        >
          {draft[field] ? formatMoney(draft[field]) : '—'}
        </dd>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {draft.duplicate ? (
        <p className={cn(amber, 'flex items-start gap-2')}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            This bill may already be recorded: the same supplier and bill number are on{' '}
            <Link href={draft.duplicate.href} target="_blank" className="font-medium underline">
              {draft.duplicate.label}
            </Link>
            . Check before saving it again.
          </span>
        </p>
      ) : null}
      {!draft.isTaxInvoice ? (
        <p className={cn(amber, 'flex items-start gap-2')}>
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <strong>Not a tax invoice — VAT not claimed.</strong>{' '}
            {draft.isCardSlip
              ? 'This is a card-machine slip: proof of payment, with no supplier TRN.'
              : 'No supplier TRN was found on it.'}{' '}
            If you hold the tax invoice, scan that instead or choose the VAT yourself.
          </span>
        </p>
      ) : null}
      <div className="rounded-lg border border-border px-4 py-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Read from the bill</p>
        <dl className="grid grid-cols-3 gap-3">
          {figure('Before VAT', 'subtotal')}
          {figure('VAT', 'vat')}
          {figure('Total', 'total')}
        </dl>
        {reasons.map((reason) => (
          <p key={reason} className="mt-2 text-xs font-medium">
            {reason}
          </p>
        ))}
        {draft.supplierTrn ? (
          <p className="mt-2 text-xs text-muted-foreground">Supplier TRN {draft.supplierTrn}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Keeps the scanned file with the record just saved. */
export async function attachScannedBill(url: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.set('bill', file);
  form.set('note', 'Scanned bill');
  const response = await fetch(url, { method: 'POST', body: form });
  const result = (await response.json().catch(() => null)) as {
    ok: boolean;
    error?: string;
  } | null;
  return result?.ok ? null : (result?.error ?? 'The bill could not be attached.');
}

export type BillScanPhase = Phase;
