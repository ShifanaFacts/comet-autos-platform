'use client';

import { Download, Printer } from 'lucide-react';
import { downloadUrl, printPdf } from '@/components/documents/share-menu';

const BUTTON =
  'inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted';

/** Print the job card sheet, or save it as a PDF. */
export function PrintJobCard({ jobCardId }: { jobCardId: string }) {
  const pdfUrl = `/documents/job-card/${jobCardId}`;
  return (
    <>
      <button type="button" className={BUTTON} onClick={() => printPdf(pdfUrl)}>
        <Printer className="size-4 text-muted-foreground" />
        Print job card
      </button>
      <a href={downloadUrl(pdfUrl)} className={BUTTON} aria-label="Download job card PDF">
        <Download className="size-4 text-muted-foreground" />
        <span className="hidden sm:inline">PDF</span>
      </a>
    </>
  );
}
