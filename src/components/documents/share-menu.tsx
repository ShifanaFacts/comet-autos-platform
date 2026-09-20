'use client';

import type { ReactElement } from 'react';
import { Copy, Download, MessageCircle, Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/*
 * Document actions shared by staff and customer screens. Nothing here talks
 * to the server beyond fetching the PDF the link points at.
 */

export const WHATSAPP = 'text-[#1fa855]';

/** Prints a same-origin PDF through a hidden frame; falls back to opening it. */
export function printPdf(url: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const downloadUrl = (pdfUrl: string) =>
  `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}download=1`;

export function ShareMenu({
  trigger,
  onWhatsApp,
  onCopyLink,
  pdfUrl,
}: {
  trigger: ReactElement;
  onWhatsApp: () => void;
  onCopyLink: () => void;
  pdfUrl: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="min-w-52">
        <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Share via</p>
        <DropdownMenuItem onClick={onWhatsApp} className="gap-2.5 py-2">
          <MessageCircle className={cn('size-4', WHATSAPP)} />
          WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopyLink} className="gap-2.5 py-2">
          <Copy className="size-4" />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={downloadUrl(pdfUrl)} />} className="gap-2.5 py-2">
          <Download className="size-4" />
          Download PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Customer page actions: Download PDF · Print · Share. The customer shares
 * the page they are on (their own secure link); whoever opens it still has
 * to confirm the registration and mobile number.
 */
export function CustomerDocumentActions({
  pdfUrl,
  shareText,
}: {
  pdfUrl: string;
  shareText: string;
}) {
  const message = () => `${shareText}\n${window.location.href}`;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button
        variant="outline"
        className="h-11"
        nativeButton={false}
        render={<a href={downloadUrl(pdfUrl)} />}
      >
        <Download />
        PDF
      </Button>
      <Button variant="outline" className="h-11" onClick={() => printPdf(pdfUrl)}>
        <Printer />
        Print
      </Button>
      <ShareMenu
        pdfUrl={pdfUrl}
        trigger={
          <Button variant="outline" className="h-11">
            <Share2 />
            Share
          </Button>
        }
        onWhatsApp={() =>
          window.open(`https://wa.me/?text=${encodeURIComponent(message())}`, '_blank', 'noopener')
        }
        onCopyLink={async () => {
          if (await copyText(window.location.href)) toast.success('Link copied');
        }}
      />
    </div>
  );
}
