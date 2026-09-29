'use client';

import { useEffect } from 'react';

/*
 * Makes a whole list row open its record.
 *
 * A row (a table row, or a card in a list) whose main link carries the
 * `row-link` class opens that link when it is tapped anywhere — not just on
 * the name. This used to be done in CSS, by stretching each link over its
 * row. That only works where the browser lets a table row contain what is
 * stretched inside it; where it doesn't (older phone browsers), every row's
 * link stretched over the WHOLE table, stacked, and the last one on top won:
 * every tap opened the same record. Here, the row that was tapped decides,
 * in every browser.
 *
 * Mounted once, in the app layout. What stays exactly as it was: tapping a
 * button, a tick box or another link inside the row; Ctrl/⌘-click or a middle
 * click on the link itself (opens a new tab); selecting text in a row.
 */

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="menuitem"], [data-no-row-link]';

export function RowLinks() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Something in the row that does its own thing.
      if (target.closest(INTERACTIVE)) return;
      // Selecting text is not a tap.
      if (window.getSelection()?.toString()) return;
      const row = target.closest('tr, li');
      const link = row?.querySelector<HTMLAnchorElement>('a.row-link');
      // Only a link that belongs to this row itself, not to a list nested in it.
      if (!link || link.closest('tr, li') !== row) return;
      link.click();
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
