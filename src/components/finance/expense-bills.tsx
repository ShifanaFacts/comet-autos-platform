'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { removeExpenseBillAction } from '@/app/(app)/finance/actions';

/**
 * The supplier's bills kept with an expense: each opens in a new tab; one
 * more can be attached (a photo or the emailed PDF).
 */
export function ExpenseBills({
  expenseId,
  bills,
  canAttach,
  canRemove,
}: {
  expenseId: string;
  bills: { id: string; fileName: string }[];
  canAttach: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set('bill', file);
      const response = await fetch(`/finance/expenses/${expenseId}/bill`, {
        method: 'POST',
        body: form,
      });
      const result = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
      } | null;
      if (result?.ok) {
        toast.success('Bill attached');
        router.refresh();
      } else {
        toast.error(result?.error ?? 'The bill could not be attached.');
      }
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {bills.map((bill) => (
        <span key={bill.id} className="inline-flex items-center gap-0.5">
          <a
            href={`/finance/expenses/bills/${bill.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[10rem] items-center gap-1 truncate text-xs text-primary hover:underline"
            title={bill.fileName}
          >
            <Paperclip className="size-3 shrink-0" />
            <span className="truncate">{bill.fileName}</span>
          </a>
          {canRemove ? (
            <button
              type="button"
              aria-label={`Remove ${bill.fileName}`}
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeExpenseBillAction(bill.id);
                  if (result.ok) router.refresh();
                  else toast.error(result.error ?? 'Could not remove it.');
                })
              }
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {canAttach ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => input.current?.click()}
            className="h-7 px-2 text-xs"
          >
            <Paperclip className="size-3" />
            {uploading ? 'Attaching…' : bills.length ? 'Add' : 'Attach bill'}
          </Button>
        </>
      ) : bills.length === 0 ? (
        <span className="text-xs text-muted-foreground">No bill</span>
      ) : null}
    </span>
  );
}
