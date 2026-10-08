/*
 * Paging for the list screens. Every list shows PAGE_SIZE rows at a time;
 * the page number rides in the URL (`?page=3`) alongside the search and
 * filters, so a page can be bookmarked and Back works.
 *
 * Two ways a list pages, the same to the person reading it:
 *   - in the database (`skip`/`take` and a count) for lists that grow without
 *     end — invoices, receipts, the journal…;
 *   - on the page (`slicePage`) for lists whose totals or stock levels are
 *     worked out over every row anyway — parts, suppliers…
 */

export const PAGE_SIZE = 25;

/** The page asked for in the URL: a whole number from 1, anything else is page 1. */
export function pageFrom(value: string | string[] | undefined): number {
  const text = Array.isArray(value) ? value[0] : value;
  const page = Number(text);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** What to skip and take for a page. */
export function pageWindow(page: number, size = PAGE_SIZE) {
  return { skip: (page - 1) * size, take: size };
}

export interface PageInfo {
  /** The page shown — never past the last one. */
  page: number;
  pageCount: number;
  total: number;
  size: number;
  /** 1-based positions of the first and last rows shown ("26–50"). */
  from: number;
  to: number;
}

/** Where a page sits among `total` rows, the page pulled back to the last one if past it. */
export function pageInfo(total: number, page: number, size = PAGE_SIZE): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    page: current,
    pageCount,
    total,
    size,
    from: total === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(current * size, total),
  };
}

/** One page of rows already loaded in full, and where it sits. */
export function slicePage<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const info = pageInfo(rows.length, page, size);
  return { rows: rows.slice((info.page - 1) * size, info.page * size), info };
}

/**
 * Loads one page from a loader that skips and takes in the database and
 * reports its total. A page past the end (a search that now matches fewer
 * rows) is loaded again as the last page, rather than shown empty.
 */
export async function loadPage<T extends { total: number }>(
  page: number,
  load: (skip: number, take: number) => Promise<T>,
  size = PAGE_SIZE,
): Promise<{ result: T; info: PageInfo }> {
  let window = pageWindow(page, size);
  let result = await load(window.skip, window.take);
  let info = pageInfo(result.total, page, size);
  if (info.page !== page) {
    window = pageWindow(info.page, size);
    result = await load(window.skip, window.take);
    info = pageInfo(result.total, info.page, size);
  }
  return { result, info };
}
