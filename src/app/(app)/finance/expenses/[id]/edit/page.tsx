import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthError, hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getExpenseDetail, getExpenseFormOptions, toExpenseDraft } from '@/lib/finance/expenses';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EditExpenseForm } from '@/components/finance/edit-expense-form';

/** Correcting an expense, on a page of its own. The original stays in its history. */
export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!hasPermission(user, 'expense.edit')) return <AccessDenied what="editing expenses" />;
  let expense;
  let options;
  try {
    [expense, options] = await Promise.all([
      getExpenseDetail(user, id),
      getExpenseFormOptions(user),
    ]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="editing expenses" />;
    throw error;
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href={`/finance/expenses/${expense.id}`} className="text-primary hover:underline">
            {expense.expenseNumber ?? expense.description}
          </Link>
        }
        title="Edit expense"
        description="Correct what was recorded. The books are re-booked to match, and the change is kept in the history."
      />
      <Panel>
        {expense.status === 'VOID' ? (
          <p className="text-sm text-muted-foreground">A voided expense cannot be changed.</p>
        ) : (
          <EditExpenseForm
            expense={toExpenseDraft(expense)}
            categories={options.categories}
            defaultVatRate={options.defaultVatRate}
            moneyAccounts={options.moneyAccounts}
            taxCodes={options.taxCodes}
            modes={options.modes}
            people={options.people}
          />
        )}
      </Panel>
    </Stack>
  );
}
