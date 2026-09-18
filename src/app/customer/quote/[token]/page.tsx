import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { CheckCircle2, Clock, Link2Off, ShieldCheck, XCircle } from 'lucide-react';
import { getQuoteAccess, loadCustomerQuote, type OrganizationBranding } from '@/lib/customer-access/quote';
import { accessCookieName, hashToken } from '@/lib/customer-access/tokens';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { cn } from '@/lib/utils';
import { DecisionForm, VerifyForm } from './quote-forms';

export const metadata: Metadata = {
  title: 'Your quotation — Comet Autos',
  robots: { index: false, follow: false },
  // Keep the secret link out of Referer headers sent to other sites.
  referrer: 'no-referrer',
};

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = await cookies();
  const proof = store.get(accessCookieName(hashToken(token)))?.value;
  const access = await getQuoteAccess(token, proof);

  if (access.state === 'invalid') {
    return (
      <Shell>
        <Notice icon={Link2Off} title="This link is not valid">
          The quotation link may have been replaced by a newer one, or copied incompletely. Please contact Comet Autos
          for an up-to-date link.
        </Notice>
      </Shell>
    );
  }
  if (access.state === 'expired') {
    return (
      <Shell organization={access.organization}>
        <Notice icon={Clock} title="This quotation has expired">
          Quotation prices are only held for a limited time. Please contact us and we&apos;ll send you an updated
          quotation{access.organization.phone ? ` — call ${access.organization.phone}` : ''}.
        </Notice>
      </Shell>
    );
  }
  if (access.state === 'needs_verification') {
    return (
      <Shell organization={access.organization}>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Confirm it&apos;s you</h1>
            <p className="text-muted-foreground">
              To protect your details, enter your vehicle registration and mobile number to view your quotation.
            </p>
          </div>
          <VerifyForm token={token} />
        </div>
      </Shell>
    );
  }

  const quote = await loadCustomerQuote(token);
  if (!quote) {
    return (
      <Shell organization={access.organization}>
        <Notice icon={Link2Off} title="This link is not valid">
          Please contact Comet Autos for an up-to-date link.
        </Notice>
      </Shell>
    );
  }

  const { jobCard } = quote;
  const vehicle = jobCard.vehicle;
  const decision = quote.approvals[0];
  const inspection = jobCard.inspections[0];
  const labour = quote.items.filter((i) => i.itemType === 'LABOUR');
  const parts = quote.items.filter((i) => i.itemType !== 'LABOUR');

  return (
    <Shell organization={access.organization}>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Quotation {quote.estimateNumber}
            {quote.sentAt ? ` · ${formatCalendarDate(quote.sentAt)}` : ''}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hello {vehicle.customer.name},</h1>
          <p className="text-muted-foreground">
            Here is the work we recommend for your vehicle. Please review it and let us know if we can go ahead.
          </p>
          <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            <VehiclePlate plateNumber={vehicle.plateNumber} />
            <div className="min-w-0">
              <p className="font-medium">
                {vehicle.make} {vehicle.model} {vehicle.year ?? ''}
              </p>
              <p className="text-sm text-muted-foreground">
                Job {jobCard.jobNumber}
                {jobCard.odometerReading !== null ? ` · ${jobCard.odometerReading.toLocaleString('en-AE')} km` : ''}
              </p>
            </div>
          </div>
        </header>

        {decision ? (
          <div
            className={cn(
              'flex items-start gap-4 rounded-xl border px-4 py-5',
              decision.status === 'APPROVED' ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5',
            )}
          >
            {decision.status === 'APPROVED' ? (
              <CheckCircle2 className="size-6 shrink-0 text-success" />
            ) : (
              <XCircle className="size-6 shrink-0 text-danger" />
            )}
            <div className="flex flex-col gap-1">
              <p className="font-semibold">
                {decision.status === 'APPROVED' ? 'You approved this quotation' : 'You declined this quotation'}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(decision.createdAt)}.{' '}
                {decision.status === 'APPROVED'
                  ? "Thank you — we'll get started and keep you updated."
                  : "We've let the workshop know. They may contact you with other options."}
              </p>
            </div>
          </div>
        ) : null}

        <QuoteSection title="Work requested">
          <p className="whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</p>
        </QuoteSection>

        {inspection && (inspection.items.length > 0 || inspection.summary) ? (
          <QuoteSection title="What our technician found">
            <div className="flex flex-col gap-4">
              {inspection.summary ? <p className="whitespace-pre-wrap">{inspection.summary}</p> : null}
              {inspection.items.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                  {inspection.items.map((item, index) => (
                    <li key={index} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className={cn(
                          'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium',
                          item.result === 'FAILED' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
                        )}
                      >
                        {item.result === 'FAILED' ? 'Needs repair' : 'Attention'}
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{item.description}</span>
                        {item.notes ? <span className="block text-muted-foreground">{item.notes}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </QuoteSection>
        ) : null}

        {jobCard.diagnoses[0]?.recommendedAction ? (
          <QuoteSection title="Our recommendation">
            <p className="whitespace-pre-wrap">{jobCard.diagnoses[0].recommendedAction}</p>
          </QuoteSection>
        ) : null}

        <QuoteSection title="Quotation">
          <div className="flex flex-col gap-6">
            {[
              { title: 'Labour', items: labour },
              { title: 'Parts', items: parts },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.title} className="flex flex-col gap-2">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</p>
                  <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                    {group.items.map((item, index) => (
                      <li key={index} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{item.description}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {Number(item.quantity.toString())} × {formatMoney(item.unitPrice)}
                            {group.title === 'Labour' ? ' per hour' : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{formatMoney(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

            <dl className="flex flex-col gap-3 rounded-xl bg-muted/60 px-4 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(quote.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="tabular-nums">{formatMoney(quote.taxAmount)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-lg font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(quote.totalAmount)}</dd>
              </div>
            </dl>
            {quote.validUntil ? (
              <p className="text-sm text-muted-foreground">Prices valid until {formatCalendarDate(quote.validUntil)}.</p>
            ) : null}
          </div>
        </QuoteSection>

        {!decision ? (
          quote.status === 'SENT' && !quote.expired ? (
            <section className="flex flex-col gap-4 border-t border-border pt-8">
              <h2 className="text-lg font-semibold tracking-tight">Can we go ahead?</h2>
              <DecisionForm token={token} total={formatMoney(quote.totalAmount)} />
            </section>
          ) : (
            <Notice icon={Clock} title="This quotation can no longer be answered online">
              Please contact Comet Autos{access.organization.phone ? ` on ${access.organization.phone}` : ''}.
            </Notice>
          )
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ organization, children }: { organization?: OrganizationBranding; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            C
          </span>
          <div className="flex flex-col">
            <span className="text-sm leading-tight font-semibold">{organization?.name ?? 'Comet Autos'}</span>
            <span className="text-xs leading-tight text-sidebar-foreground/60">Secure customer quotation</span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <p className="font-medium text-foreground">{organization?.legalName ?? organization?.name ?? 'Comet Autos'}</p>
          {organization?.address ? <p>{organization.address}</p> : null}
          {organization?.phone ? <p>Tel {organization.phone}</p> : null}
          {organization?.taxNumber ? <p>TRN {organization.taxNumber}</p> : null}
        </div>
      </footer>
    </div>
  );
}

function QuoteSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Notice({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card px-6 py-8">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
