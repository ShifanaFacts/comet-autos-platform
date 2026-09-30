/**
 * Unit tests for the module × action permission catalogue:
 *
 * - nothing in src/ still names a code the catalogue doesn't have;
 * - the upgrade from the old codes keeps every role's reach exactly — for
 *   each new code, "allowed after" equals "allowed before" (whether the role
 *   held the old code that used to guard the same screens);
 * - the presets, the View rule and the audit log's sensitive list.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PERMISSION_ACTIONS,
  PERMISSION_CODES,
  PERMISSION_MODULES,
  ROLE_PRESETS,
} from '@/lib/auth/permission-catalog';
import { withImpliedView } from '@/lib/access/roles';
import { auditModule, isSensitive } from '@/lib/access/audit';
import { foldWarnings, OLD_TO_NEW, upgradeCodes } from '../prisma/ensure-permissions';

const OLD_CODES = Object.keys(OLD_TO_NEW);

/** New code → the old codes whose screens it now guards. */
const SOURCES = new Map<string, string[]>();
for (const [old, targets] of Object.entries(OLD_TO_NEW)) {
  for (const target of targets) SOURCES.set(target, [...(SOURCES.get(target) ?? []), old]);
}

/** For every new code: may this role use it now, and could it before? */
function reach(oldCodes: string[], isSystem = false) {
  const held = new Set(oldCodes);
  const after = new Set(upgradeCodes(oldCodes, isSystem));
  return PERMISSION_CODES.map((code) => ({
    code,
    before: isSystem || (SOURCES.get(code) ?? []).some((old) => held.has(old)),
    after: after.has(code),
  }));
}

const VIEW_ONLY_OLD = OLD_CODES.filter((code) => code.endsWith('.view'));

describe('the catalogue', () => {
  test('every code is <module>.<action>, with one of the six actions', () => {
    for (const code of PERMISSION_CODES) {
      const [module, action, extra] = code.split('.');
      assert.equal(extra, undefined, code);
      assert.ok(
        PERMISSION_MODULES.some((entry) => entry.key === module),
        code,
      );
      assert.ok((PERMISSION_ACTIONS as readonly string[]).includes(action), code);
    }
    assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length, 'no duplicates');
  });

  test('every module has View', () => {
    for (const entry of PERMISSION_MODULES) assert.ok(entry.actions.view, entry.key);
  });

  test('nothing in src/ names a code the catalogue does not have', () => {
    const modules = new Set([
      ...PERMISSION_MODULES.map((module) => module.key),
      ...OLD_CODES.map((code) => code.split('.')[0]),
    ]);
    const actions = new Set([
      ...PERMISSION_ACTIONS,
      ...OLD_CODES.map((code) => code.split('.')[1]),
    ]);
    const literal = /['"]([a-z_]+)\.([a-z_]+)['"]/g;
    const stray: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        for (const [, module, action] of text.matchAll(literal)) {
          if (!modules.has(module) || !actions.has(action)) continue;
          const code = `${module}.${action}`;
          if (!PERMISSION_CODES.includes(code)) {
            stray.push(`${path.relative(process.cwd(), full)}: ${code}`);
          }
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    assert.deepEqual(stray, [], 'codes used in src/ but missing from the catalogue');
  });
});

describe('upgrading the old codes', () => {
  test('every old code is in the table, and every target exists', () => {
    for (const code of [
      'job_card.assign',
      'job_card.close',
      'inventory.issue',
      'inventory.adjust',
      'inventory.manage',
      'purchase.receive',
      'invoice.cancel',
      'payment.reverse',
      'user.manage',
      'role.manage',
    ]) {
      assert.ok(code in OLD_TO_NEW, code);
    }
    for (const targets of Object.values(OLD_TO_NEW)) {
      for (const target of targets) assert.ok(PERMISSION_CODES.includes(target), target);
    }
  });

  test('every new code comes from exactly one old code — except the one documented fold', () => {
    for (const code of PERMISSION_CODES) {
      const sources = SOURCES.get(code) ?? [];
      if (code === 'audit.view' || code === 'audit.export') {
        assert.deepEqual(sources, [], 'the audit log is new: only the Owner starts with it');
      } else if (code === 'job_card.approve') {
        assert.deepEqual(sources.sort(), ['job_card.assign', 'job_card.close']);
      } else {
        assert.equal(sources.length, 1, `${code} comes from ${sources.join(', ') || 'nothing'}`);
      }
    }
  });

  test('the Owner keeps exactly its access: everything, the audit log included', () => {
    assert.deepEqual(upgradeCodes(OLD_CODES, true), PERMISSION_CODES);
    for (const row of reach(OLD_CODES, true)) assert.equal(row.after, row.before, row.code);
  });

  test('a full-access role that is not the Owner keeps exactly its access', () => {
    for (const row of reach(OLD_CODES)) {
      if (row.code.startsWith('audit.')) continue;
      assert.equal(row.after, row.before, row.code);
    }
  });

  test('a view-only role keeps exactly its access, and can still change nothing', () => {
    const rows = reach(VIEW_ONLY_OLD);
    for (const row of rows) assert.equal(row.after, row.before, row.code);
    const granted = rows.filter((row) => row.after).map((row) => row.code);
    assert.ok(granted.length > 0);
    for (const code of granted) {
      assert.ok(
        code.endsWith('.view') || code.endsWith('.export'),
        `${code}: viewing lists always included downloading them`,
      );
    }
  });

  test('any mix of old codes keeps its reach (outside the fold)', () => {
    const mixes = [
      ['job_card.view', 'job_card.edit', 'customer.view', 'vehicle.view'],
      ['invoice.view', 'invoice.create', 'payment.create'],
      ['inventory.view', 'purchase.create'],
      ['payroll.view', 'payroll.create'],
      ['accounting.view', 'accounting.create'],
      ['user.view'],
    ];
    for (const mix of mixes) {
      for (const row of reach(mix)) assert.equal(row.after, row.before, `${mix}: ${row.code}`);
    }
  });

  test('a role holding one side of the fold is reported', () => {
    assert.equal(foldWarnings(['job_card.assign', 'job_card.close']).length, 0);
    assert.equal(foldWarnings(['job_card.close']).length, 1);
    assert.equal(foldWarnings(['job_card.view']).length, 0);
  });
});

describe('role presets', () => {
  test('every preset names real codes and keeps the View rule', () => {
    for (const preset of ROLE_PRESETS) {
      for (const code of preset.codes) assert.ok(PERMISSION_CODES.includes(code), code);
      assert.deepEqual(withImpliedView(preset.codes).sort(), [...preset.codes].sort(), preset.key);
    }
  });

  test('Owner-like is everything; Partner is every View, report downloads and the audit log', () => {
    const owner = ROLE_PRESETS.find((preset) => preset.key === 'owner')!;
    assert.deepEqual([...owner.codes].sort(), [...PERMISSION_CODES].sort());
    const partner = ROLE_PRESETS.find((preset) => preset.key === 'partner')!;
    const views = PERMISSION_CODES.filter((code) => code.endsWith('.view'));
    assert.deepEqual(
      [...partner.codes].sort(),
      [...new Set([...views, 'reports.export', 'audit.view'])].sort(),
    );
  });

  test('ticking anything on a module ticks its View', () => {
    assert.deepEqual(withImpliedView(['invoice.delete']), ['invoice.view', 'invoice.delete']);
    assert.deepEqual(withImpliedView(['reports.export']), ['reports.view', 'reports.export']);
  });
});

describe('the audit log', () => {
  test('reversals, voids, deletions, credit notes, journals, merges and access changes are sensitive', () => {
    for (const action of [
      'payment.reversed',
      'invoice.voided',
      'purchase.cancelled',
      'part.deleted',
      'credit_note.issued',
      'journal.created',
      'customer.merged_in',
      'role.permissions_changed',
      'user.roles_changed',
      'user.password_reset',
    ]) {
      assert.ok(isSensitive(action), action);
    }
    for (const action of ['invoice.issued', 'payment.recorded', 'customer.created']) {
      assert.equal(isSensitive(action), false, action);
    }
  });

  test('each action belongs to a module', () => {
    assert.equal(auditModule('payment.reversed', 'Payment'), 'payment');
    assert.equal(auditModule('books.closed', 'Organization'), 'accounting');
    assert.equal(auditModule('customer_access.link_shared', 'Estimate'), 'quotation');
    assert.equal(auditModule('tax_code.created', 'TaxCode'), 'settings');
  });
});
