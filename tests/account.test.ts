/**
 * The signed-in user's account: profile and password change.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { changePassword, getAccountProfile } from '@/lib/auth/account';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, hashSessionToken } from '@/lib/auth/session';
import { createTestOrg, expectDomainError, type TestOrg } from './support';

let org: TestOrg;

before(async () => {
  org = await createTestOrg('Account');
  await prisma.user.update({
    where: { id: org.owner.id },
    data: { passwordHash: await hashPassword('Garage2026'), phone: '050 999 1122' },
  });
});

after(async () => {
  await prisma.$disconnect();
});

describe('account', () => {
  test('profile shows who is signed in, without secrets', async () => {
    const profile = await getAccountProfile(org.owner);
    assert.equal(profile.email, 'owner@test.local');
    assert.equal(profile.phone, '050 999 1122');
    assert.equal(profile.isActive, true);
    assert.ok(!('passwordHash' in profile), 'no password hash');
    assert.ok(!JSON.stringify(profile).includes('$2'), 'no bcrypt material anywhere');
  });

  test('password change is checked, and signs out other sessions only', async () => {
    const current = await createSession(org.owner.id, org.organizationId);
    const otherDevice = await createSession(org.owner.id, org.organizationId);

    await expectDomainError(
      changePassword(
        org.owner,
        {
          currentPassword: 'wrong-one1',
          newPassword: 'NewGarage2026',
          confirmPassword: 'NewGarage2026',
        },
        current,
      ),
      /current password is not correct/,
    );
    await expectDomainError(
      changePassword(
        org.owner,
        { currentPassword: 'Garage2026', newPassword: 'short1', confirmPassword: 'short1' },
        current,
      ),
      /at least 8/,
    );
    await expectDomainError(
      changePassword(
        org.owner,
        {
          currentPassword: 'Garage2026',
          newPassword: 'onlyletters',
          confirmPassword: 'onlyletters',
        },
        current,
      ),
      /letter and one number/,
    );
    await expectDomainError(
      changePassword(
        org.owner,
        {
          currentPassword: 'Garage2026',
          newPassword: 'NewGarage2026',
          confirmPassword: 'NewGarage2027',
        },
        current,
      ),
      /two new passwords are different/,
    );
    await expectDomainError(
      changePassword(
        org.owner,
        { currentPassword: 'Garage2026', newPassword: 'Garage2026', confirmPassword: 'Garage2026' },
        current,
      ),
      /different from your current/,
    );

    const result = await changePassword(
      org.owner,
      {
        currentPassword: 'Garage2026',
        newPassword: 'NewGarage2026',
        confirmPassword: 'NewGarage2026',
      },
      current,
    );
    assert.ok(result.otherSessionsSignedOut >= 1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: org.owner.id } });
    assert.ok(await verifyPassword('NewGarage2026', user.passwordHash));
    assert.ok(!(await verifyPassword('Garage2026', user.passwordHash)));

    const kept = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(current) },
    });
    const revoked = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(otherDevice) },
    });
    assert.equal(kept.revokedAt, null, 'the session that changed the password stays signed in');
    assert.ok(revoked.revokedAt, 'other devices are signed out');
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: org.owner.id, action: 'user.password_changed' },
      }),
    );
  });
});
