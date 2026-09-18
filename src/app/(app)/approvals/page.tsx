import { BadgeCheck } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { getWorkQueues } from '@/lib/workshop/workspace';
import { PageHeader, Section, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { EstimateTable, isExpired } from '@/components/workshop/estimate-table';

export default async function ApprovalsPage() {
  const user = await requireUser();
  const { estimates } = await getWorkQueues(user);
  const waiting = estimates.filter((e) => e.status === 'SENT' && !isExpired(e));
  const expired = estimates.filter((e) => isExpired(e));
  const decided = estimates
    .filter((e) => e.status === 'APPROVED' || e.status === 'REJECTED')
    .sort((a, b) => (b.approvals[0]?.decidedAt.getTime() ?? 0) - (a.approvals[0]?.decidedAt.getTime() ?? 0));

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Workshop"
        title="Approvals"
        description="Quotations waiting on customers, and the decisions they've made."
      />
      <Section title={`Waiting for the customer (${waiting.length})`} description="Follow up on anything waiting more than a day.">
        {waiting.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="Nothing is waiting for approval" description="Sent quotations appear here until the customer responds." />
        ) : (
          <EstimateTable estimates={waiting} dateLabel="sent" />
        )}
      </Section>
      {expired.length > 0 ? (
        <Section title={`Expired without an answer (${expired.length})`} description="Revise and resend, or call the customer.">
          <EstimateTable estimates={expired} dateLabel="sent" />
        </Section>
      ) : null}
      <Section title="Recent decisions" description="Approved work can move to repair; rejected quotations can be revised.">
        {decided.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <EstimateTable estimates={decided} dateLabel="decided" />
        )}
      </Section>
    </Stack>
  );
}
