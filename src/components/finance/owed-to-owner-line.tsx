import Link from 'next/link';
import { ArrowRight, UserRoundCheck } from 'lucide-react';
import { getOwedToOwnersTotal } from '@/lib/finance/owner-payments';
import { formatMoney } from '@/lib/format';

/**
 * "Owed to owner: AED X" — a quiet line on the dashboards while the workshop
 * owes its owner for bills he paid personally. Nothing when it owes nothing.
 * The caller decides who may see it (Accounts → View).
 */
export async function OwedToOwnerLine({ organizationId }: { organizationId: string }) {
  const owed = await getOwedToOwnersTotal(organizationId);
  if (Number(owed) <= 0) return null;
  return (
    <Link
      href="/finance/owner-advances"
      className="group flex w-fit items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted/50"
    >
      <UserRoundCheck className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">Owed to owner:</span>
      <span className="font-semibold tabular-nums">{formatMoney(owed)}</span>
      <ArrowRight className="size-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
