'use client';

import { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyText, downloadUrl, printPdf, WHATSAPP } from '@/components/documents/share-menu';
import { shareDocumentAction, type ShareActionData } from '@/app/(app)/documents/actions';

type ShareTarget = { kind: 'quotation' | 'invoice' | 'receipt'; id: string };

/**
 * Staff actions for one customer document: View · PDF · WhatsApp, with
 * Print and Copy link under "more". Sharing issues a fresh secure customer
 * link on the server; the same link is reused for the rest of the visit.
 */
export function StaffDocumentActions({
  pdfUrl,
  target,
  canShare = true,
}: {
  pdfUrl: string;
  target: ShareTarget;
  canShare?: boolean;
}) {
  const shared = useRef<ShareActionData | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function prepare(): Promise<ShareActionData | null> {
    if (shared.current) return shared.current;
    setBusy(true);
    const result = await shareDocumentAction(target);
    setBusy(false);
    if (!result.ok || !result.data) {
      toast.error(result.error ?? 'Could not create the customer link.');
      return null;
    }
    shared.current = result.data;
    return result.data;
  }

  async function whatsApp() {
    // Open the tab now, inside the click, so pop-up blockers allow it; point it at WhatsApp once the link exists.
    const tab = shared.current ? null : window.open('about:blank', '_blank');
    const data = await prepare();
    if (!data) return tab?.close();
    if (tab) tab.location.href = data.whatsappUrl;
    else window.open(data.whatsappUrl, '_blank', 'noopener');
    toast.success('WhatsApp opened with the message ready to send');
  }

  async function copyLink() {
    const data = await prepare();
    if (data && (await copyText(data.link))) {
      setCopied(true);
      toast.success('Secure customer link copied');
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Finger-sized on a phone, compact once there is a mouse.
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 [&_a]:h-11 [&_button]:h-11 [&_button]:min-w-11 sm:[&_a]:h-8 sm:[&_button]:h-8 sm:[&_button]:min-w-0">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<a href={pdfUrl} target="_blank" rel="noreferrer" />}
        aria-label="View"
      >
        <Eye />
        <span className="hidden sm:inline">View</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<a href={downloadUrl(pdfUrl)} />}
        aria-label="Download PDF"
      >
        <Download />
        <span className="hidden sm:inline">PDF</span>
      </Button>
      {canShare ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={whatsApp}
          disabled={busy}
          aria-label="Share on WhatsApp"
        >
          {busy ? <Loader2 className="animate-spin" /> : <MessageCircle className={WHATSAPP} />}
          <span className="hidden sm:inline">WhatsApp</span>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => printPdf(pdfUrl)} className="gap-2.5 py-2">
            <Printer className="size-4" />
            Print
          </DropdownMenuItem>
          {canShare ? (
            <DropdownMenuItem onClick={copyLink} className="gap-2.5 py-2">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy customer link
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
