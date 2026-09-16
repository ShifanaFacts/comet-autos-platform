import { PageHeader } from '@/components/shell/page-header';

/**
 * Placeholder for a module listed in the V1 build instruction that hasn't
 * been built yet. Deliberately explicit rather than a 404 or fake data —
 * see PROJECT-STATUS.md's Roadmap section for what phase adds this module.
 */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium">Not built yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {title} is planned for {phase}. See PROJECT-STATUS.md for the current roadmap.
        </p>
      </div>
    </div>
  );
}
