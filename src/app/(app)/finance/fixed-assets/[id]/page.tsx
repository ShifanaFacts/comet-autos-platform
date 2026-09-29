import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthError, hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getFixedAsset } from '@/lib/accounting/fixed-assets';
import { getAccountChoices } from '@/lib/accounting/reports';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { StatusPill } from '@/components/shared/status-pill';
import { DeleteAssetButton, DisposeAssetForm } from '@/components/accounting/fixed-asset-forms';

const FUNDING_LABEL = {
  PAID: 'Paid for',
  ON_CREDIT: 'Bought on credit',
  OPENING: 'Owned before the books began',
} as const;

const account = (a: { accountCode: string; accountName: string } | null) =>
  a ? `${a.accountCode} ${a.accountName}` : '—';

export default async function FixedAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let asset;
  try {
    asset = await getFixedAsset(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="the fixed asset register" />;
    throw error;
  }
  const canEdit = hasPermission(user, 'accounting.edit');
  const active = asset.status === 'ACTIVE';
  const money = canEdit && active ? (await getAccountChoices(user)).money : [];

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/fixed-assets" className="text-primary hover:underline">
            {`Fixed assets · ${asset.assetNumber}`}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {asset.name}
            {active ? (
              <StatusPill tone="success">In use</StatusPill>
            ) : (
              <StatusPill tone="neutral">Disposed</StatusPill>
            )}
          </span>
        }
        description={asset.description ?? undefined}
        actions={
          canEdit && active && asset.depreciations.length === 0 ? (
            <DeleteAssetButton assetId={asset.id} label={asset.assetNumber} />
          ) : undefined
        }
      />

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="xl" className="xl:col-span-7">
          <Panel className="grid gap-4 sm:grid-cols-3">
            <Figure label="Cost" value={formatMoney(asset.cost.toString())} />
            <Figure label="Depreciation to date" value={formatMoney(asset.accumulated)} />
            <Figure
              label={active ? 'Book value' : 'Book value when disposed'}
              value={formatMoney(asset.bookValue)}
            />
          </Panel>

          <Section
            title="Depreciation"
            description={
              active
                ? `${formatMoney(asset.monthlyCharge)} a month, ${asset.remainingMonths} month${asset.remainingMonths === 1 ? '' : 's'} to go.`
                : 'Charged while it was in use.'
            }
          >
            <Panel padding="none" className="overflow-hidden">
              <div className="max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2.5 pl-6">Month ending</th>
                      <th className="px-4 py-2.5 pr-6 text-right">Charge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Number(asset.openingDepreciation.toString()) > 0 ? (
                      <tr>
                        <td className="px-4 py-2 pl-6">
                          {`Before the books, to ${asset.openingThrough ? formatCalendarDate(asset.openingThrough) : '—'}`}
                        </td>
                        <td className="px-4 py-2 pr-6 text-right tabular-nums">
                          {formatMoney(asset.openingDepreciation.toString())}
                        </td>
                      </tr>
                    ) : null}
                    {asset.depreciations.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 pl-6 tabular-nums">
                          {formatCalendarDate(row.periodEnd)}
                        </td>
                        <td className="px-4 py-2 pr-6 text-right tabular-nums">
                          {formatMoney(row.amount.toString())}
                        </td>
                      </tr>
                    ))}
                    {asset.upcoming.map((row) => (
                      <tr key={row.periodEnd.toISOString()} className="text-muted-foreground">
                        <td className="px-4 py-2 pl-6 tabular-nums">
                          {`${formatCalendarDate(row.periodEnd)} · to come`}
                        </td>
                        <td className="px-4 py-2 pr-6 text-right tabular-nums">
                          {formatMoney(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </Section>
        </Stack>

        <Stack gap="xl" className="xl:col-span-5">
          <Section title="Details">
            <Panel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Acquired</dt>
                <dd className="text-right">{formatCalendarDate(asset.acquiredOn)}</dd>
                <dt className="text-muted-foreground">How</dt>
                <dd className="text-right">
                  {FUNDING_LABEL[asset.funding]}
                  {asset.paidFrom ? ` — from ${asset.paidFrom.accountName}` : ''}
                </dd>
                <dt className="text-muted-foreground">Useful life</dt>
                <dd className="text-right">{`${asset.usefulLifeMonths} months`}</dd>
                <dt className="text-muted-foreground">Residual value</dt>
                <dd className="text-right">{formatMoney(asset.residualValue.toString())}</dd>
                <dt className="text-muted-foreground">Asset account</dt>
                <dd className="text-right">{account(asset.assetAccount)}</dd>
                <dt className="text-muted-foreground">Accumulated depreciation</dt>
                <dd className="text-right">{account(asset.accumulatedAccount)}</dd>
                <dt className="text-muted-foreground">Charged to</dt>
                <dd className="text-right">{account(asset.expenseAccount)}</dd>
                <dt className="text-muted-foreground">Recorded</dt>
                <dd className="text-right">{`${formatDateTime(asset.createdAt)} by ${asset.createdBy.fullName}`}</dd>
                {!active ? (
                  <>
                    <dt className="text-muted-foreground">Disposed of</dt>
                    <dd className="text-right">
                      {asset.disposedOn ? formatCalendarDate(asset.disposedOn) : '—'}
                    </dd>
                    <dt className="text-muted-foreground">Proceeds</dt>
                    <dd className="text-right">
                      {formatMoney(asset.disposalProceeds?.toString() ?? '0')}
                      {asset.proceedsAccount ? ` into ${asset.proceedsAccount.accountName}` : ''}
                    </dd>
                    <dt className="text-muted-foreground">Gain / (loss)</dt>
                    <dd className="text-right font-medium">
                      {asset.gainOnDisposal?.startsWith('-')
                        ? `(${formatMoney(asset.gainOnDisposal.slice(1))})`
                        : formatMoney(asset.gainOnDisposal ?? '0')}
                    </dd>
                  </>
                ) : null}
              </dl>
            </Panel>
          </Section>

          {canEdit && active ? (
            <Section title="Sell or scrap it">
              <Panel>
                <DisposeAssetForm
                  assetId={asset.id}
                  today={localDateString()}
                  moneyAccounts={money}
                />
              </Panel>
            </Section>
          ) : null}
        </Stack>
      </Grid>
    </Stack>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
    </div>
  );
}
