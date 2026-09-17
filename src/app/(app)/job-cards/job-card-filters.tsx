'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { WORKFLOW_STAGES } from '@/lib/workshop/stages';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...WORKFLOW_STAGES.map((stage) => ({ value: stage.status, label: stage.label })),
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function JobCardFilters({ status, q }: { status: string; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(q);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (query === q) return;
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (query) params.set('q', query);
      router.push(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function updateStatus(nextStatus: string) {
    const params = new URLSearchParams();
    if (nextStatus) params.set('status', nextStatus);
    if (query) params.set('q', query);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search job #, plate, customer"
          className="pl-9"
        />
      </div>
      <select
        value={status}
        onChange={(event) => updateStatus(event.target.value)}
        className="h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
