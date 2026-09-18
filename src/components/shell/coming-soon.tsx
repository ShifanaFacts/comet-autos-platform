import { Construction } from 'lucide-react';
import { PageHeader, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';

/**
 * Placeholder for a module listed in the V1 build instruction that hasn't
 * been built yet. Deliberately explicit rather than a 404 or fake data —
 * see PROJECT-STATUS.md's Roadmap section for what phase adds this module.
 */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader title={title} description={`This module is planned for ${phase}.`} />
      <EmptyState
        icon={Construction}
        title={`${title} is coming in ${phase}`}
        description="See PROJECT-STATUS.md for the current roadmap."
      />
    </Stack>
  );
}
