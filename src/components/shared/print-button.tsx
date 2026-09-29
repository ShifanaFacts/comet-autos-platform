'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Prints the page's .print-sheet on its own — or saves it as a PDF from the print dialog. */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <Button type="button" variant="outline" className="h-10" onClick={() => window.print()}>
      <Printer />
      {label}
    </Button>
  );
}
