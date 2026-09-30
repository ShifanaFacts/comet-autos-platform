/*
 * Remembering a lookup for the length of one database transaction.
 *
 * Booking a twelve-line delivery books twelve journal entries in one
 * transaction, and each used to re-read the same chart of accounts and the
 * same VAT settings. Against a hosted database every read is a network
 * round-trip, and enough of them run the transaction out of time. Inside a
 * transaction those answers cannot change under it, so they are read once.
 *
 * Keyed on the transaction client itself (a WeakMap), so nothing outlives
 * the transaction and nothing is shared between two of them. Only ever used
 * with a transaction client — never the shared `prisma` client, where the
 * answer could go stale.
 */

const memos = new WeakMap<object, Map<string, Promise<unknown>>>();

export function txMemo<T>(tx: object, key: string, load: () => Promise<T>): Promise<T> {
  let memo = memos.get(tx);
  if (!memo) {
    memo = new Map();
    memos.set(tx, memo);
  }
  const held = memo.get(key);
  if (held) return held as Promise<T>;
  const loading = load();
  memo.set(key, loading);
  // A failed read is not remembered: the next caller tries again.
  loading.catch(() => memo.delete(key));
  return loading;
}

/** Forgets a remembered lookup — for the transaction that itself changes the answer. */
export function txForget(tx: object, key: string) {
  memos.get(tx)?.delete(key);
}
