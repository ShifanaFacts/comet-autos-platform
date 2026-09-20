import type { CustomerDocumentModel, DocumentTone } from '@/lib/documents/model';
import { formatAed, formatQuantity } from '@/lib/documents/model';
import { StatusPill, type PillTone } from '@/components/shared/status-pill';
import { cn } from '@/lib/utils';

/*
 * The priced part of a customer document (item groups and totals), laid out
 * for phones. Reads the same model the PDF is drawn from, so the page and the
 * PDF can never disagree.
 */

const TONE: Record<DocumentTone, PillTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
};

export function DocumentStatus({ status }: { status: CustomerDocumentModel['status'] }) {
  return <StatusPill tone={TONE[status.tone]}>{status.label}</StatusPill>;
}

export function DocumentItems({ document }: { document: CustomerDocumentModel }) {
  return (
    <div className="flex flex-col gap-6">
      {document.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {section.title}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
            {section.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-4 px-4 py-3.5">
                <span className="min-w-0">
                  <span className="block text-[0.95rem] leading-snug font-medium">
                    {line.description}
                  </span>
                  <span className="block pt-0.5 text-xs text-muted-foreground tabular-nums">
                    {formatQuantity(line.quantity)} × {formatAed(line.unitPrice)}
                    {section.title === 'Labour' ? ' per hour' : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[0.95rem] font-medium tabular-nums">
                  {formatAed(line.lineTotal)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function DocumentTotals({ document }: { document: CustomerDocumentModel }) {
  return (
    <dl className="flex flex-col gap-2.5 rounded-2xl bg-muted/70 px-4 py-4 text-sm">
      {document.totals.map((total) => (
        <div
          key={total.label}
          className={cn(
            'flex items-baseline justify-between gap-4',
            total.emphasis === 'total' && 'border-t border-border pt-3 text-lg font-semibold',
            total.emphasis === 'balance' && 'text-base font-semibold text-primary',
          )}
        >
          <dt className={cn(!total.emphasis && 'text-muted-foreground')}>{total.label}</dt>
          <dd className="tabular-nums">{formatAed(total.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}
