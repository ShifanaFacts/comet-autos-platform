import Link from 'next/link';
import { Info, Percent } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { listTaxCodes } from '@/lib/accounting/tax-codes';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import { EditTaxCodeButton, NewTaxCodeForm } from '@/components/accounting/tax-code-forms';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Where each treatment is reported on the VAT201. */
const BOX: Record<string, string> = {
  STANDARD: `Box 1 (sales) · Box 9 (purchases)`,
  ZERO_RATED: 'Box 4',
  EXEMPT: 'Box 5',
  OUT_OF_SCOPE: 'Not reported',
};

export default async function TaxCodesPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.view')) return <AccessDenied what="the accounts" />;
  const codes = await listTaxCodes(user);
  const canEdit = hasPermission(user, 'accounting.edit');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/accounting?view=accounts" className="hover:text-foreground">
            Accounting
          </Link>
        }
        title="Tax codes"
        description="How every sales and purchase line is taxed. The code decides the VAT rate and where the line goes on the VAT return."
      />

      {canEdit ? (
        <Panel padding="none" className="overflow-hidden">
          <InlineForm
            label="Add a tax code"
            hint="Another rate, or a separate code to report something on its own."
            icon={<Percent className="size-4" />}
          >
            <NewTaxCodeForm />
          </InlineForm>
        </Panel>
      ) : null}

      <Section title="Codes">
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="w-20 px-4 py-3 pl-6">Code</th>
                  <th className="px-2 py-3">Name</th>
                  <th className="w-20 px-2 py-3 text-right">Rate</th>
                  <th className="px-2 py-3">VAT return</th>
                  <th className="px-2 py-3">Used on</th>
                  <th className="w-0 px-4 py-3 pr-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {codes.map((code) => (
                  <tr key={code.id} className={cn(!code.isActive && 'text-muted-foreground')}>
                    <td className="px-4 py-3 pl-6 font-mono text-xs font-semibold">{code.code}</td>
                    <td className="px-2 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        {code.name}
                        {code.isDefault ? <StatusPill tone="primary">Default</StatusPill> : null}
                        {code.isSystem ? <StatusPill tone="info">Standard</StatusPill> : null}
                        {code.isActive ? null : <StatusPill tone="neutral">Retired</StatusPill>}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {code.treatmentLabel}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {code.rate.replace(/\.?0+$/, '')}%
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">{BOX[code.treatment]}</td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {[code.forSales ? 'Sales' : null, code.forPurchases ? 'Purchases' : null]
                        .filter(Boolean)
                        .join(' · ')}
                      {code.uses ? (
                        <span className="block text-xs tabular-nums">
                          {code.uses} line{code.uses === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 pr-6 text-right">
                      {canEdit ? <EditTaxCodeButton code={code} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />A code&apos;s rate is copied onto each line
          when it is saved, so changing or retiring a code never changes an invoice already issued.
          The standard-rated code (SR) is the rate in Settings.
        </p>
      </Section>
    </Stack>
  );
}
