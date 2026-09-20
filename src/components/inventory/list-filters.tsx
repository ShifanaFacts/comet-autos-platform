'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/forms/fields';

export interface FilterSelect {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Search box plus dropdown filters that live in the URL, so a filtered list
 * survives refresh and can be shared. Typing is debounced; every other
 * parameter is kept when one changes.
 */
export function ListFilters({
  placeholder,
  selects = [],
}: {
  placeholder: string;
  selects?: FilterSelect[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`);
  }

  useEffect(() => {
    if (query.trim() === initialQuery.trim()) return;
    const timeout = setTimeout(() => navigate({ q: query.trim() }), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const active = selects.some((select) => searchParams.get(select.name)) || initialQuery;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 pl-9 text-base md:text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        {selects.map((select) => (
          <NativeSelect
            key={select.name}
            aria-label={select.label}
            value={searchParams.get(select.name) ?? ''}
            onChange={(event) => navigate({ [select.name]: event.target.value })}
            className="h-10 sm:w-auto"
          >
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        ))}
      </div>
      {active ? (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            router.replace(pathname);
          }}
          className="inline-flex h-10 items-center gap-1.5 self-start rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground sm:self-auto"
        >
          <X className="size-4" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
