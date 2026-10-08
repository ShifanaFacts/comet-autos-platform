import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageInfo } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/*
 * The pager under every list: "Showing 26–50 of 312", Previous / Next, and
 * the page numbers around the current one. Plain links, so it works without
 * JavaScript and Back returns to the page before; the search and filters in
 * the URL are kept, only `page` changes. Nothing is shown for a list that
 * fits on one page.
 *
 * On a phone only Previous, "Page 2 of 13" and Next — finger-sized; the
 * numbers join from `sm` up.
 */

/** Page numbers to offer: the first, the last, and two either side of the current, with gaps. */
function pageNumbers(page: number, count: number): (number | 'gap')[] {
  const wanted = new Set([1, count, page - 2, page - 1, page, page + 1, page + 2]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  for (const [index, n] of pages.entries()) {
    if (index > 0 && n - pages[index - 1] > 1) out.push('gap');
    out.push(n);
  }
  return out;
}

export function Pagination({
  info,
  basePath,
  params,
  noun = 'records',
  className,
}: {
  info: PageInfo;
  /** The list's own path, e.g. "/finance/invoices". */
  basePath: string;
  /** The screen's current search params — kept on every link, `page` replaced. */
  params: Record<string, string | string[] | undefined>;
  /** What the rows are, plural: "invoices". */
  noun?: string;
  className?: string;
}) {
  if (info.pageCount <= 1) return null;

  const href = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'page' || value === undefined || value === '') continue;
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
    }
    if (page > 1) search.set('page', String(page));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const step =
    'inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted sm:h-9 sm:min-w-9';
  const disabled = 'pointer-events-none opacity-40';

  return (
    <nav
      aria-label="Pages"
      className={cn(
        'flex flex-col items-center gap-3 border-t border-border px-4 py-4 sm:flex-row sm:justify-between sm:px-6',
        className,
      )}
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {info.from.toLocaleString('en-AE')}–{info.to.toLocaleString('en-AE')} of{' '}
        {info.total.toLocaleString('en-AE')} {noun}
      </p>
      <div className="flex items-center gap-1.5">
        <Link
          href={href(info.page - 1)}
          aria-disabled={info.page === 1}
          tabIndex={info.page === 1 ? -1 : undefined}
          className={cn(step, info.page === 1 && disabled)}
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Link>
        <span className="px-2 text-sm text-muted-foreground tabular-nums sm:hidden">
          Page {info.page} of {info.pageCount}
        </span>
        <ol className="hidden items-center gap-1 sm:flex">
          {pageNumbers(info.page, info.pageCount).map((n, index) =>
            n === 'gap' ? (
              <li key={`gap-${index}`} aria-hidden className="px-1 text-sm text-muted-foreground">
                …
              </li>
            ) : (
              <li key={n}>
                <Link
                  href={href(n)}
                  aria-current={n === info.page ? 'page' : undefined}
                  className={cn(
                    step,
                    'tabular-nums',
                    n === info.page &&
                      'border-primary bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  {n}
                </Link>
              </li>
            ),
          )}
        </ol>
        <Link
          href={href(info.page + 1)}
          aria-disabled={info.page === info.pageCount}
          tabIndex={info.page === info.pageCount ? -1 : undefined}
          className={cn(step, info.page === info.pageCount && disabled)}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </nav>
  );
}
