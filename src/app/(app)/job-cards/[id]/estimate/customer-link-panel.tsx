'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Shows the customer's secure quotation link once, right after it's issued.
 * Only a hash is stored, so the link can't be shown again later — a new one
 * can be issued instead (which revokes this one).
 */
export function CustomerLinkPanel({
  link,
  customerName,
  onDone,
}: {
  link: string;
  customerName: string;
  onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-success/30 bg-success/5 px-4 py-6 sm:px-8">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <ShieldCheck className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold tracking-tight">Quotation link ready for {customerName}</p>
          <p className="text-sm text-muted-foreground">
            Send this link by WhatsApp, SMS or email. The customer confirms their vehicle registration and mobile number
            before they can see or approve it. Copy it now — for security it can&apos;t be shown again.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className="h-10 font-mono text-xs" aria-label="Customer link" />
        <div className="flex shrink-0 gap-3">
          <Button size="lg" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button size="lg" variant="outline" nativeButton={false} render={<a href={link} target="_blank" rel="noreferrer" />}>
            <ExternalLink />
            Preview
          </Button>
        </div>
      </div>
      {onDone ? (
        <Button variant="ghost" className="self-start" onClick={onDone}>
          Done
        </Button>
      ) : null}
    </div>
  );
}
