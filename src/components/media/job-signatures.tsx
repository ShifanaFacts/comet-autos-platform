import { PenLine } from 'lucide-react';
import type { JobSignature } from '@/lib/media/photos';
import { formatDateTime } from '@/lib/format';

const CONTEXT_LABEL = {
  QUOTATION_APPROVAL: 'Quotation approved',
  DELIVERY_HANDOVER: 'Vehicle handed over',
} as const;

/**
 * The signatures captured on this job. A signature is a business record —
 * who signed, for what, when — so that is what is shown; the image itself is
 * served by document id through the permission-checked media route.
 */
export function JobSignatures({ signatures }: { signatures: JobSignature[] }) {
  // "Not signed" is itself a fact worth stating — a signature is optional,
  // so its absence is a recorded outcome, not a gap in the screen.
  if (signatures.length === 0) {
    return (
      <p className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-6">
        <PenLine className="size-4 shrink-0" />
        No signature provided. A signature is optional — approvals and handovers are valid without
        one.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {signatures.map((signature) => (
        <li
          key={signature.id}
          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <PenLine className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">
              {CONTEXT_LABEL[signature.context]}
              {signature.approval?.estimate ? (
                <span className="text-muted-foreground">
                  {' '}
                  · {signature.approval.estimate.estimateNumber}
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              Signed by {signature.signerName}
              {signature.signerType === 'STAFF' ? ' (workshop)' : ''} ·{' '}
              {formatDateTime(signature.signedAt)}
              {signature.capturedBy ? ` · recorded by ${signature.capturedBy.fullName}` : ''}
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by id through the permission-checked media route */}
          <img
            src={`/media/${signature.documentId}`}
            alt={`Signature of ${signature.signerName}`}
            className="h-16 w-40 shrink-0 self-start rounded-md border border-border bg-white object-contain p-1 sm:self-center"
          />
        </li>
      ))}
    </ul>
  );
}
