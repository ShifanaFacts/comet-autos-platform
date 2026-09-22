'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';

/*
 * Narrowing the payables list. The filters live in the URL so a view can be
 * shared and reloaded, and the server does the narrowing — nothing is
 * filtered out of a list the browser was handed whole.
 */

const AGES = [
  { value: '', label: 'Any age' },
  { value: '31', label: 'Over 30 days' },
  { value: '61', label: 'Over 60 days' },
  { value: '91', label: 'Over 90 days' },
];

export function PayableFilters({
  suppliers,
  current,
}: {
  suppliers: { id: string; name: string }[];
  current: { q: string; supplierId: string; olderThanDays: string };
}) {
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    const query = new URLSearchParams();
    for (const key of ['q', 'supplierId', 'olderThanDays']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) query.set(key, value);
    }
    const search = query.toString();
    startTransition(() =>
      router.replace(search ? `/finance/payables?${search}` : '/finance/payables'),
    );
  }

  const hasFilters = Boolean(current.q || current.supplierId || current.olderThanDays);
  const select =
    'h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:text-sm';

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) apply(event.currentTarget);
      }}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          defaultValue={current.q}
          placeholder="Search supplier, purchase or invoice number"
          aria-label="Search payables"
          onChange={(event) => {
            const form = event.currentTarget.form;
            if (debounce.current) clearTimeout(debounce.current);
            debounce.current = setTimeout(() => form && apply(form), 350);
          }}
          className="h-12 w-full rounded-xl border border-input bg-card pr-10 pl-9 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:text-sm"
        />
        {isPending ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <select
        name="supplierId"
        defaultValue={current.supplierId}
        aria-label="Filter by supplier"
        className={select}
      >
        <option value="">All suppliers</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>

      <select
        name="olderThanDays"
        defaultValue={current.olderThanDays}
        aria-label="Filter by age"
        className={select}
      >
        {AGES.map((age) => (
          <option key={age.value} value={age.value}>
            {age.label}
          </option>
        ))}
      </select>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace('/finance/payables'))}
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground md:h-11"
        >
          <X className="size-4" />
          Clear
        </button>
      ) : null}
    </form>
  );
}
