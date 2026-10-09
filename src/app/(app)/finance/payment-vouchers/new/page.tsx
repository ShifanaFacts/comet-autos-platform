import Link from 'next/link';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { getPaymentVoucherFormOptions } from '@/lib/finance/payment-vouchers';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { CardCollectionForm, WorkPaymentForm } from '@/components/finance/payment-voucher-forms';

export const metadata = { title: 'New payment voucher' };

/** A new voucher: card money paid over to someone, or outside work paid for. */
export default async function NewPaymentVoucherPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await requireUser();
  const { kind } = await searchParams;
  const work = kind === 'work';
  let options;
  try {
    options = await getPaymentVoucherFormOptions(user);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="payment vouchers" />;
    throw error;
  }
  if (work && !options.canRecordWork) return <AccessDenied what="expenses" />;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/payment-vouchers" className="text-primary hover:underline">
            Payment vouchers
          </Link>
        }
        title={work ? 'Pay for outside work' : 'Card money collected for someone'}
        description={
          work
            ? 'An outside mechanic or a sublet repair, paid in cash or from the bank. It is recorded as an expense — and counted in the job’s cost when it was for one — with a voucher for them to sign.'
            : 'Their customer paid on our card machine. The money is theirs: it is recorded as owed to them, and paid over less what the bank keeps — its card fee and the VAT on it — so it costs the workshop nothing.'
        }
      />
      <Panel>
        {work ? (
          <WorkPaymentForm options={options} today={localDateString()} />
        ) : (
          <CardCollectionForm options={options} today={localDateString()} />
        )}
      </Panel>
    </Stack>
  );
}
