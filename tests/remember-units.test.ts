/**
 * "Remember me": which sessions are remembered, when one is renewed, and the
 * cookie each kind of login gets. Pure rules — no database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRememberedSession,
  needsRenewal,
  REMEMBER_TTL_MS,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from '@/lib/auth/remember';

const DAY = 1000 * 60 * 60 * 24;

describe('remember me', () => {
  test('an ordinary login is 7 days; a remembered one is renewed up to 400 days', () => {
    const created = new Date('2026-10-05T08:00:00Z');
    assert.equal(
      isRememberedSession({
        createdAt: created,
        expiresAt: new Date(created.getTime() + SESSION_TTL_MS),
      }),
      false,
    );
    assert.equal(
      isRememberedSession({
        createdAt: created,
        expiresAt: new Date(created.getTime() + REMEMBER_TTL_MS),
      }),
      true,
    );
  });

  test('renewed at most once a day', () => {
    const now = Date.now();
    assert.equal(needsRenewal(new Date(now + REMEMBER_TTL_MS), now), false, 'just signed in');
    assert.equal(needsRenewal(new Date(now + REMEMBER_TTL_MS - DAY / 2), now), false, 'same day');
    assert.equal(needsRenewal(new Date(now + REMEMBER_TTL_MS - 2 * DAY), now), true, 'two days on');
  });

  test('the cookie lasts as long as the login', () => {
    assert.equal(sessionCookieOptions(false).maxAge, 7 * 24 * 60 * 60);
    assert.equal(sessionCookieOptions(true).maxAge, 400 * 24 * 60 * 60);
    assert.equal(sessionCookieOptions(true).httpOnly, true);
  });
});
