import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { canSeePay, getPayrollRun, PAYROLL_STATUS_LABEL, type PayrollRun } from '@/lib/hr/payroll';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { RecordCard, RecordList, TableWrap } from '@/components/shared/record-card';
import { StatusPill, type PillTone } from '@/components/shared/status-pill';
import { AdjustDeductionButton, PayrollRunActions } from '@/components/hr/payroll-forms';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, PillTone> = {
  DRAFT: 'neutral',
  CALCULATED: 'warning',
  APPROVED: 'info',
  PAID: 'success',
  CANCELLED: 'neutral',
};

type Line = PayrollRun['lines'][number];

/** Leave and absence behind a line, in words. Empty when there is nothing to say. */
function notes(line: Line) {
  return [
    line.unpaidLeaveDays ? `${line.unpaidLeaveDays} unpaid leave` : null,
    line.paidLeaveDays ? `${line.paidLeaveDays} paid leave` : null,
    line.absentDays ? `${line.absentDays} absent` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canSeePay(user)) return <AccessDenied what="payroll" />;
  const { id } = await params;

  let run: PayrollRun;
  try {
    run = await getPayrollRun(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canPrepare = hasPermission(user, 'payroll.edit');
  const canApprove = hasPermission(user, 'payroll.approve');
  const editable = run.status === 'CALCULATED' && canPrepare;

  const trail = [
    run.calculatedAt ? `Calculated ${formatDateTime(run.calculatedAt)} by ${run.createdBy}` : null,
    run.approvedAt ? `Approved ${formatDateTime(run.approvedAt)} by ${run.approvedBy}` : null,
    run.paidAt ? `Paid ${formatDateTime(run.paidAt)} by ${run.paidBy}` : null,
  ].filter(Boolean);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/hr/payroll" className="hover:text-foreground">
            Payroll
          </Link>
        }
        title={
          <>
            {run.label}
            <StatusPill tone={STATUS_TONE[run.status]}>
              {PAYROLL_STATUS_LABEL[run.status]}
            </StatusPill>
          </>
        }
        description={`${formatCalendarDate(run.periodStart)} to ${formatCalendarDate(run.periodEnd)} · ${run.days} days`}
      />

      <Panel className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Employees</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {run.totals.count}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Gross</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(run.totals.gross)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Deductions</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(run.totals.deductions)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Net to pay</span>
          <span className="text-2xl leading-none font-semibold text-primary tabular-nums">
            {formatMoney(run.totals.net)}
          </span>
        </div>
      </Panel>

      <PayrollRunActions
        payrollId={run.id}
        label={run.label}
        status={run.status}
        net={run.totals.net}
        canPrepare={canPrepare}
        canApprove={canApprove}
      />

      <Section
        title="Lines"
        description={
          editable
            ? 'Check each line before approval. Absences are shown but only deducted if you change the deduction.'
            : 'What each person is paid for the month.'
        }
      >
        <Panel padding="none" className="overflow-hidden">
          <RecordList>
            {run.lines.map((line) => (
              <RecordCard
                key={line.id}
                title={line.employee.name}
                subtitle={[line.employee.employeeCode, line.employee.jobTitle]
                  .filter(Boolean)
                  .join(' · ')}
                amount={formatMoney(line.netPay)}
                details={[
                  { label: 'Basic', value: formatMoney(line.basicSalary) },
                  { label: 'Allowances', value: formatMoney(line.allowances) },
                  { label: 'Deductions', value: formatMoney(line.deductions) },
                  { label: 'Leave & absence', value: notes(line) || null },
                ]}
              >
                {editable ? (
                  <AdjustDeductionButton
                    payrollId={run.id}
                    itemId={line.id}
                    employeeName={line.employee.name}
                    gross={line.gross}
                    deductions={line.deductions}
                  />
                ) : null}
              </RecordCard>
            ))}
          </RecordList>

          <TableWrap>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-4 pl-6">Employee</th>
                  <th className="px-2 py-4">Leave &amp; absence</th>
                  <th className="w-28 px-2 py-4 text-right">Basic</th>
                  <th className="w-28 px-2 py-4 text-right">Allowances</th>
                  <th className="w-28 px-2 py-4 text-right">Deductions</th>
                  <th className="w-32 px-4 py-4 pr-6 text-right">Net pay</th>
                  {editable ? <th className="w-0 px-2 py-4" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {run.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-4 pl-6">
                      <Link
                        href={`/hr/employees/${line.employee.id}`}
                        className="font-medium hover:underline"
                      >
                        {line.employee.name}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        <span className="font-mono">{line.employee.employeeCode}</span>
                        {line.employee.jobTitle ? ` · ${line.employee.jobTitle}` : ''}
                      </span>
                    </td>
                    <td className="px-2 py-4 text-muted-foreground">{notes(line) || '—'}</td>
                    <td className="px-2 py-4 text-right tabular-nums">
                      {formatMoney(line.basicSalary)}
                    </td>
                    <td className="px-2 py-4 text-right tabular-nums">
                      {formatMoney(line.allowances)}
                    </td>
                    <td className="px-2 py-4 text-right tabular-nums">
                      {line.deductions === '0.00' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `−${formatMoney(line.deductions)}`
                      )}
                    </td>
                    <td className="px-4 py-4 pr-6 text-right font-semibold tabular-nums">
                      {formatMoney(line.netPay)}
                    </td>
                    {editable ? (
                      <td className="px-2 py-4 text-right">
                        <AdjustDeductionButton
                          payrollId={run.id}
                          itemId={line.id}
                          employeeName={line.employee.name}
                          gross={line.gross}
                          deductions={line.deductions}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-4 pl-6" colSpan={4}>
                    Total
                  </td>
                  <td className="px-2 py-4 text-right tabular-nums">
                    −{formatMoney(run.totals.deductions)}
                  </td>
                  <td className="px-4 py-4 pr-6 text-right tabular-nums">
                    {formatMoney(run.totals.net)}
                  </td>
                  {editable ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        </Panel>
      </Section>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        {trail.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Salaries are taken as they stood on the last day of the month and pro-rated for anyone who
          joined or left during it. Approved unpaid leave is deducted at (basic + allowances) ÷ days
          in the month.
        </p>
      </div>
    </Stack>
  );
}
