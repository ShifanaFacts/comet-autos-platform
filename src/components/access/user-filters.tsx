'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Filtering the user list. The filters live in the URL, so a view can be
 * shared, bookmarked and reloaded — and the server does the narrowing, so
 * nothing is filtered out of a list the browser was handed in full.
 */

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
] as const;

export function UserFilters({
  roles,
  branches,
  current,
}: {
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  current: { q: string; status: string; roleId: string; branchId: string };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    const query = new URLSearchParams();
    for (const key of ['q', 'status', 'roleId', 'branchId']) {
      const value = String(data.get(key) ?? '').trim();
      // 'active' is the default view, so it stays out of the URL.
      if (value && !(key === 'status' && value === 'active')) query.set(key, value);
    }
    const search = query.toString();
    startTransition(() => router.replace(search ? `/settings/users?${search}` : '/settings/users'));
  }

  const hasFilters = Boolean(
    current.q || current.roleId || current.branchId || current.status !== 'active',
  );
  const select =
    'h-11 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-10 md:text-sm';

  return (
    <form
      ref={formRef}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) apply(event.currentTarget);
      }}
      className="flex flex-col gap-3"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          defaultValue={current.q}
          placeholder="Search by name, email, mobile or employee code"
          aria-label="Search users"
          onChange={(event) => {
            // Typing shouldn't fire a query per keystroke on workshop Wi-Fi.
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

      {/* Status as segments: three choices, one tap, no dropdown. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-xl border border-border bg-card p-1 sm:flex-none">
          {STATUSES.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex h-11 flex-1 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors sm:h-9 sm:flex-none',
                current.status === option.value
                  ? 'bg-foreground text-background'
                  : 'text-foreground/70 hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="status"
                value={option.value}
                defaultChecked={current.status === option.value}
                className="sr-only"
                onChange={(event) => event.currentTarget.form && apply(event.currentTarget.form)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <select name="roleId" defaultValue={current.roleId} aria-label="Filter by role" className={select}>
          <option value="">All roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>

        {branches.length > 1 ? (
          <select
            name="branchId"
            defaultValue={current.branchId}
            aria-label="Filter by branch"
            className={select}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="branchId" value={current.branchId} />
        )}

        {hasFilters ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.replace('/settings/users'))}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:h-10"
          >
            <X className="size-4" />
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
