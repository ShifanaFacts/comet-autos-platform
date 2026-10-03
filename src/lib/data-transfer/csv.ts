/*
 * CSV in and out, with no dependency.
 *
 * Out: RFC 4180 quoting, CRLF line endings and a UTF-8 byte-order mark, so a
 * file opens correctly in Excel on a Windows machine — including Arabic
 * names and the dirham sign — and a value that starts with = + - @ is
 * written so Excel treats it as text rather than a formula.
 *
 * In: the same quoting rules, tolerant of CRLF or LF, a trailing newline,
 * and a header row whose names differ in case or spacing.
 */

export type CsvValue = string | number | null | undefined | Date | { toString(): string };

export interface CsvColumn<Row> {
  /** The heading written to the file, and the name accepted when reading. */
  header: string;
  value: (row: Row) => CsvValue;
}

const NEEDS_QUOTES = /[",\r\n]/;
/** Excel reads a leading = + - @ as a formula; a leading apostrophe keeps it text. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number — a stock movement of -2, a refund of -50.00 — can't be a formula, and must stay a number. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const lines = [columns.map((column) => cell(column.header)).join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** A file name that is safe on every platform, with today's date in it. */
/** `prefix` is the workshop, e.g. the brand's filePrefix. */
export function csvFileName(prefix: string, label: string, today = new Date()): string {
  const date = today.toISOString().slice(0, 10);
  return `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}.csv`;
}

/**
 * Splits CSV text into rows of raw cells. Quoted cells may contain commas and
 * newlines. The separator is read from the heading row: a comma, or the
 * semicolon Excel uses in some regions, or the tab of a sheet copied as text.
 */
export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const heading = input.split(/\r?\n/, 1)[0] ?? '';
  const count = (char: string) => heading.split(char).length - 1;
  const separator = [',', ';', '\t'].reduce(
    (best, char) => (count(char) > count(best) ? char : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(value);
      value = '';
    } else if (char === '\r') {
      // Handled by the \n that follows; a lone \r also ends the row.
      if (input[i + 1] !== '\n') {
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      }
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((text) => text.trim() !== ''));
}

/** Header names match however they were typed: case, spaces and underscores are ignored. */
const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface CsvSheet {
  headers: string[];
  /** One record per row, keyed by the file's own headings. */
  records: Record<string, string>[];
}

/**
 * Reads the file into records keyed by a normalized header name, so
 * "Mobile number", "mobile_number" and "MobileNumber" are the same column.
 * The leading apostrophe Excel-safe export adds is stripped back off.
 */
export function parseCsv(text: string): CsvSheet {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((header) => header.trim());
  const keys = headers.map(key);
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((name, index) => {
      const raw = (cells[index] ?? '').trim();
      record[name] = raw.startsWith("'") ? raw.slice(1) : raw;
    });
    return record;
  });
  return { headers, records };
}

/** The value of a column by any of the names it may appear under. */
export function field(record: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = record[key(name)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

/**
 * A value by how its column's heading starts — "Total (AED)" or "Total incl.
 * VAT" for "total" — for files whose headings add a unit or a note. Headings
 * starting with any of `not` are passed over.
 */
export function fieldStarting(
  record: Record<string, string>,
  starts: string[],
  not: string[] = [],
): string {
  for (const start of starts) {
    for (const [name, value] of Object.entries(record)) {
      if (value !== '' && name.startsWith(start) && !not.some((skip) => name.startsWith(skip))) {
        return value;
      }
    }
  }
  return '';
}

/**
 * A template file with the headings and one example row, for someone
 * starting from scratch — plus any further example rows, keyed by heading.
 */
export function csvTemplate(
  columns: { header: string; example?: string }[],
  moreExamples: Record<string, string>[] = [],
): string {
  const headers = columns.map((column) => cell(column.header)).join(',');
  const rows = [
    columns.map((column) => cell(column.example ?? '')).join(','),
    ...moreExamples.map((example) =>
      columns.map((column) => cell(example[column.header] ?? '')).join(','),
    ),
  ];
  return `﻿${headers}\r\n${rows.join('\r\n')}\r\n`;
}
