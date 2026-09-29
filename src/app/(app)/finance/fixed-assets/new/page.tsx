import Link from 'next/link';
import { AuthError, requirePermission, requireUser } from '@/lib/auth/authorize';
import { getFixedAssetAccountChoices } from '@/lib/accounting/fixed-assets';
import { getAccountChoices } from '@/lib/accounting/reports';
import { localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { FixedAssetForm } from '@/components/accounting/fixed-asset-forms';

export const metadata = { title: 'Add fixed asset' };

export default async function NewFixedAssetPage() {
  const user = await requireUser();
  let choices;
  let money;
  try {
    requirePermission(user, 'accounting.edit');
    [choices, money] = await Promise.all([
      getFixedAssetAccountChoices(user),
      getAccountChoices(user).then((c) => c.money),
    ]);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the fixed asset register" />;
    throw error;
  }
  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/fixed-assets" className="text-primary hover:underline">
            Fixed assets
          </Link>
        }
        title="Add a fixed asset"
        description="Something the workshop owns and uses for more than a year. It is booked at cost and depreciated monthly over its useful life, starting the month after it was bought."
      />
      <Panel>
        <FixedAssetForm choices={choices} moneyAccounts={money} today={localDateString()} />
      </Panel>
    </Stack>
  );
}
