/**
 * Unit tests for which menu item is current: the most specific match, a
 * tab link only on its own tab.
 *
 *   npm run test:unit
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { activeNavHref, NAV_GROUPS } from '@/lib/nav';

const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
const params = (query = '') => new URLSearchParams(query);

describe('the current menu item', () => {
  test('a page under a section lights its own item, not the section overview', () => {
    assert.equal(activeNavHref('/finance/expenses', params(), hrefs), '/finance/expenses');
    assert.equal(
      activeNavHref('/finance/accounting/opening-balances', params(), hrefs),
      '/finance/accounting/opening-balances',
    );
    assert.equal(activeNavHref('/finance', params(), hrefs), '/finance');
  });

  test('a record page lights its list', () => {
    assert.equal(activeNavHref('/finance/invoices/abc', params(), hrefs), '/finance/invoices');
  });

  test('an accounting tab lights only its own item', () => {
    assert.equal(
      activeNavHref('/finance/accounting', params('view=trial&asOf=2026-01-31'), hrefs),
      '/finance/accounting?view=trial',
    );
    assert.equal(
      activeNavHref('/finance/accounting', params('view=cash&period=month'), hrefs),
      '/finance/accounting?view=cash',
    );
  });

  test('a prefix of a word is not a match', () => {
    assert.equal(activeNavHref('/financeX', params(), hrefs), null);
  });

  test('the dashboard only on its own page', () => {
    assert.equal(activeNavHref('/', params(), hrefs), '/');
    assert.notEqual(activeNavHref('/customers', params(), hrefs), '/');
  });
});
