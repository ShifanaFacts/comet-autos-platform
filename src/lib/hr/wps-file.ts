/*
 * The WPS Salary Information File (SIF) and the checks on its details, as
 * pure rules — no database. lib/hr/wps.ts loads a payroll and calls these.
 */

export const PERSON_CODE = /^\d{14}$/;
export const ROUTING = /^\d{9}$/;

/** A UAE IBAN: AE, two check digits, 19 more — and its check digits right. */
export function validUaeIban(value: string): boolean {
  if (!/^AE\d{21}$/.test(value)) return false;
  const moved = value.slice(4) + value.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export interface SifEmployee {
  name: string;
  personCode: string | null;
  agentCode: string | null;
  iban: string | null;
  /** Paid this month, in fils: basic and allowances less deductions. */
  fixedFils: number;
  variableFils: number;
  leaveDays: number;
}

export interface SifInput {
  establishmentId: string | null;
  routingCode: string | null;
  periodStart: string;
  periodEnd: string;
  /** The moment the file is made, in UAE time: "YYYY-MM-DD" and "HHMM", plus seconds. */
  createdDay: string;
  createdTime: string;
  createdSeconds: string;
  employees: SifEmployee[];
}

const amount = (fils: number) => (fils / 100).toFixed(2);

/** The SIF's lines and file name, or what is missing before it can be made. */
export function buildSif(input: SifInput) {
  const problems: string[] = [];
  if (!input.establishmentId || !/^\d{13}$/.test(input.establishmentId)) {
    problems.push(
      'The company’s MOHRE establishment number (13 digits) — enter it in Finance → Tax & accounting calendar → company dates.',
    );
  }
  if (!input.routingCode || !ROUTING.test(input.routingCode)) {
    problems.push(
      'The routing code of the bank the salaries are paid from (9 digits) — on the same form; the bank gives it.',
    );
  }
  for (const employee of input.employees) {
    const missing = [
      !employee.personCode ? 'MOHRE person code' : null,
      !employee.agentCode ? 'bank routing code' : null,
      !employee.iban ? 'IBAN' : null,
    ].filter(Boolean);
    if (missing.length)
      problems.push(`${employee.name}: ${missing.join(', ')} — on their employee page.`);
  }
  const days =
    Math.round(
      (new Date(`${input.periodEnd}T00:00:00Z`).getTime() -
        new Date(`${input.periodStart}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  const lines = input.employees.map((employee) =>
    [
      'EDR',
      employee.personCode ?? '',
      employee.agentCode ?? '',
      employee.iban ?? '',
      input.periodStart,
      input.periodEnd,
      String(days),
      amount(employee.fixedFils),
      amount(employee.variableFils),
      String(employee.leaveDays),
    ].join(','),
  );
  const totalFils = input.employees.reduce((sum, e) => sum + e.fixedFils + e.variableFils, 0);
  const month = `${input.periodStart.slice(5, 7)}${input.periodStart.slice(0, 4)}`;
  lines.push(
    [
      'SCR',
      input.establishmentId ?? '',
      input.routingCode ?? '',
      input.createdDay,
      input.createdTime,
      month,
      String(input.employees.length),
      amount(totalFils),
      'AED',
      `SALARY ${month}`,
    ].join(','),
  );
  const stamp = `${input.createdDay.slice(2).replace(/-/g, '')}${input.createdTime}${input.createdSeconds}`;
  return {
    problems,
    fileName: `${input.establishmentId ?? 'ESTABLISHMENT'}${stamp}.SIF`,
    content: `${lines.join('\r\n')}\r\n`,
    totalFils,
  };
}
