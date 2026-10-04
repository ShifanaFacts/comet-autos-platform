'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, MonitorPlay, Power, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createDisplayLinkAction, revokeDisplayLinkAction } from '@/app/(app)/settings/actions';

/*
 * The waiting-area TV link. Making one shows it once — only a fingerprint
 * of it is kept — so open it on the TV (or copy it) straight away. A new
 * link replaces the old one; switching it off stops it everywhere.
 */
export function DisplayLinkForm({ active, canEdit }: { active: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function make() {
    startTransition(async () => {
      const result = await createDisplayLinkAction();
      if (!result.ok || !result.data) {
        toast.error(result.error ?? 'The link could not be made.');
        return;
      }
      setLink(`${window.location.origin}/display/${result.data.token}`);
      router.refresh();
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeDisplayLinkAction();
      if (!result.ok) {
        toast.error(result.error ?? 'It could not be switched off.');
        return;
      }
      setLink(null);
      toast.success('TV link switched off');
      router.refresh();
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Copy didn’t work — select the link and copy it.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A screen for customers: each car’s plate, make and where it stands (checked in, awaiting approval, in
        progress, ready). No names, phone numbers or prices. It updates itself every 30 seconds — open the
        link in the TV’s browser and leave it.
      </p>
      <p className="text-sm">
        Status: <span className="font-medium">{active ? 'a TV link is active' : 'no TV link'}</span>
      </p>
      {link ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">Shown once — open it on the TV now, or copy it.</p>
          <code className="text-xs break-all">{link}</code>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={copy}>
              <Copy />
              Copy
            </Button>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              <ExternalLink className="size-4" />
              Open
            </a>
          </div>
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-11" onClick={make} disabled={pending}>
            {active ? <RefreshCw /> : <MonitorPlay />}
            {active ? 'Make a new link (old one stops)' : 'Make TV link'}
          </Button>
          {active ? (
            <Button type="button" variant="destructive" className="h-11" onClick={revoke} disabled={pending}>
              <Power />
              Switch off
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
