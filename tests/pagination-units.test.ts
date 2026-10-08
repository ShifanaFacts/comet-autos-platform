/**
 * Paging the list screens: the page read from the URL, where a page sits,
 * slicing rows already loaded, and a page past the end falling back to the
 * last one. Pure rules — no database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, pageFrom, pageInfo, slicePage } from '@/lib/pagination';

describe('pagination', () => {
  test('the page in the URL is a whole number from 1; anything else is page 1', () => {
    assert.equal(pageFrom('3'), 3);
    assert.equal(pageFrom(['4', '9']), 4);
    for (const bad of [undefined, '', '0', '-2', '1.5', 'abc']) assert.equal(pageFrom(bad), 1);
  });

  test('where a page sits: "26–50 of 60", the last page short, past the end pulled back', () => {
    assert.deepEqual(pageInfo(60, 2, 25), {
      page: 2,
      pageCount: 3,
      total: 60,
      size: 25,
      from: 26,
      to: 50,
    });
    assert.equal(pageInfo(60, 3, 25).to, 60);
    assert.equal(pageInfo(60, 9, 25).page, 3);
  });

  test('an empty list is one page showing nothing', () => {
    const info = pageInfo(0, 1, 25);
    assert.equal(info.pageCount, 1);
    assert.equal(info.from, 0);
    assert.equal(info.to, 0);
  });

  test('slicing rows already loaded', () => {
    const rows = Array.from({ length: 30 }, (_, i) => i + 1);
    const { rows: page2, info } = slicePage(rows, 2, 25);
    assert.deepEqual(page2, [26, 27, 28, 29, 30]);
    assert.equal(info.pageCount, 2);
    assert.deepEqual(slicePage(rows, 7, 25).rows, page2);
  });

  test('a page past the end of a narrowed search loads the last page instead', async () => {
    const all = Array.from({ length: 30 }, (_, i) => i + 1);
    const calls: number[] = [];
    const { result, info } = await loadPage(
      5,
      async (skip, take) => {
        calls.push(skip);
        return { rows: all.slice(skip, skip + take), total: all.length };
      },
      25,
    );
    assert.deepEqual(calls, [100, 25]);
    assert.equal(info.page, 2);
    assert.deepEqual(result.rows, [26, 27, 28, 29, 30]);
  });
});
