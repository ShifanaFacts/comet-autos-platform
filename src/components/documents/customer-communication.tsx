import type { LucideIcon } from 'lucide-react';
import { FileText, Receipt, ReceiptText } from 'lucide-react';
import type { JobDocuments } from '@/lib/documents/build';
import { formatAed } from '@/lib/documents/model';
import { formatDate } from '@/lib/format';
import { Panel } from '@/components/layout/primitives';
import { StaffDocumentActions } from '@/components/documents/document-actions';
import { DocumentStatus } from '@/components/documents/document-body';

/**
 * The job card's "Customer communication" block: one compact row per
 * customer document — quotation(s), invoice, receipts — each with
 * View · PDF · WhatsApp. Shown only once there is something to send.
 */
export function CustomerCommunication({
  documents,
  canShareQuotation,
}: {
  documents: JobDocuments;
  canShareQuotation: boolean;
}) {
  const { quotations, invoice } = documents;
  if (quotations.length === 0 && !invoice) return null;

  return (
    <Panel padding="none">
      <ul className="divide-y divide-border">
        {quotations.map((quotation) => (
          <Row
            key={quotation.id}
            icon={FileText}
            title={quotation.title}
            number={quotation.number}
            status={quotation.status}
            detail={formatAed(quotation.total)}
            actions={
              <StaffDocumentActions
                pdfUrl={`/documents/quotation/${quotation.id}`}
                target={{ kind: 'quotation', id: quotation.id }}
                canShare={canShareQuotation && quotation.status.label !== 'Expired'}
              />
            }
          />
        ))}
        {invoice ? (
          <Row
            icon={ReceiptText}
            title="Invoice"
            number={invoice.number}
            status={invoice.status}
            detail={
              invoice.balance === '0.00'
                ? formatAed(invoice.total)
                : `${formatAed(invoice.balance)} due`
            }
            actions={
              <StaffDocumentActions
                pdfUrl={`/documents/invoice/${invoice.id}`}
                target={{ kind: 'invoice', id: invoice.id }}
              />
            }
          />
        ) : null}
        {invoice?.receipts.map((receipt) => (
          <Row
            key={receipt.id}
            icon={Receipt}
            title="Receipt"
            number={receipt.number}
            detail={`${formatAed(receipt.amount)} · ${formatDate(receipt.receivedAt)}`}
            actions={
              <StaffDocumentActions
                pdfUrl={`/documents/receipt/${receipt.id}`}
                target={{ kind: 'receipt', id: receipt.id }}
              />
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

function Row({
  icon: Icon,
  title,
  number,
  status,
  detail,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  number: string;
  status?: JobDocuments['quotations'][number]['status'];
  detail: string;
  actions: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {title} <span className="font-normal text-muted-foreground">{number}</span>
            </p>
            {status ? <DocumentStatus status={status} /> : null}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">{detail}</p>
        </div>
      </div>
      <div className="-ml-2 pl-11">{actions}</div>
    </li>
  );
}
