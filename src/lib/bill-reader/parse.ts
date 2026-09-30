/*
 * Reading a supplier's bill from its text.
 *
 * The text comes from a PDF's own text layer or from OCR of a photo, so it
 * is noisy: columns run together, a decimal point goes missing, Arabic and
 * English share a line. Everything here is a pure function of that text —
 * no database, no network — and works by one rule: fill a field only when
 * the text supports it, and leave it empty otherwise. A blank the user
 * types is cheap; a wrong amount saved into the books is not.
 *
 * Amounts are the part that can be checked: subtotal + VAT must equal the
 * total. The three are chosen together so that they do, a missing one is
 * worked out from the other two, and anything that still doesn't add up is
 * returned with a warning rather than quietly trusted.
 */

export interface ParsedLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface BillWarning {
  field: 'subtotal' | 'vat' | 'total' | 'billDate' | 'lines';
  message: string;
}

export interface ParsedBill {
  /** The supplier's 15-digit TRN, digits only. Never our own. */
  supplierTrn: string | null;
  /** A guess at the supplier's name from the top of the bill. */
  supplierName: string | null;
  /** The first lines of the bill, for matching a supplier already on file. */
  headerLines: string[];
  billNumber: string | null;
  /** YYYY-MM-DD */
  billDate: string | null;
  subtotal: string | null;
  vat: string | null;
  total: string | null;
  /** A tax invoice (VAT can be reclaimed): says so, and carries the supplier's TRN. */
  isTaxInvoice: boolean;
  /** A card-machine slip: proof of payment, not a tax invoice. */
  isCardSlip: boolean;
  /** Item rows, only when they add up to the subtotal. */
  lines: ParsedLine[];
  warnings: BillWarning[];
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Latin digits, plain spaces, one line per row — and no card numbers. */
export function normalise(text: string): string[] {
  const latin = text
    .replace(/[\u0660-\u0669]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    // No-break and other typographic spaces, then the typographic dashes.
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-');
  return redactCards(latin)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * Card numbers are never kept: a masked one (**** **** **** 1234, 4567XXXXXXXX1234)
 * or sixteen digits in fours becomes "[card]" before anything else reads the text.
 * OCR garbles the mask ("*¥¥* xxkx 44717"), so on a line that names a card or
 * carries a mask, every long run of plain digits goes too — an amount, with
 * its decimal point, stays.
 */
const CARD_LINE = /\b(?:card|visa|master|mada|amex|debit|credit\s+card)\b|[*•¥«»]{2,}|x{3,}/i;

export function redactCards(text: string): string {
  return text
    .replace(/(?:\d{4,6}[ -]?)?(?:[*xX•#]{2,}[ -]?){1,4}\d{2,4}/g, '[card]')
    .replace(/(?<!\d)(?:\d{4}[ -]){3}\d{4}(?!\d)/g, '[card]')
    .split('\n')
    .map((line) =>
      CARD_LINE.test(line)
        ? line.replace(/(?<![\d.,])\d{4,}(?![\d.,]*[.,]\d)(?!\d)/g, '[card]')
        : line,
    )
    .join('\n');
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');

// ─── TRN ────────────────────────────────────────────────────────────────────

const TRN_RUN = /(?<!\d)(?:\d[ -]?){14}\d(?!\d)/g;
const TRN_LABEL = /\bT\.?\s?R\.?\s?N\b|tax\s+reg|vat\s+reg|الرقم\s+الضريبي|رقم\s+التسجيل/i;

/** The supplier's TRN: fifteen digits that aren't ours, preferring one that is labelled. */
export function findSupplierTrn(lines: string[], ownTrn?: string | null): string | null {
  const own = ownTrn ? digitsOnly(ownTrn) : '';
  const found: { trn: string; labelled: boolean }[] = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(TRN_RUN)) {
      const trn = digitsOnly(match[0]);
      if (trn.length !== 15 || trn === own) continue;
      // The label can sit on the line above when OCR splits a row.
      const labelled = TRN_LABEL.test(line) || (index > 0 && TRN_LABEL.test(lines[index - 1]));
      found.push({ trn, labelled });
    }
  });
  // UAE TRNs begin 100; an unlabelled run that doesn't is more likely a phone
  // or account number than a TRN.
  const pick =
    found.find((item) => item.labelled && item.trn.startsWith('100')) ??
    found.find((item) => item.labelled) ??
    found.find((item) => item.trn.startsWith('100'));
  return pick?.trn ?? null;
}

// ─── Bill number ────────────────────────────────────────────────────────────

const NUMBER_LABEL =
  /(?:tax\s+invoice|invoice|inv|doc(?:ument)?|bill|receipt|voucher)\.?\s*(?:no|number|num|#)\s*\.?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/\-]{0,24})/i;

export function findBillNumber(lines: string[]): string | null {
  for (const line of lines) {
    if (TRN_LABEL.test(line) && !/invoice|bill|receipt|doc/i.test(line)) continue;
    const match = NUMBER_LABEL.exec(line);
    if (!match) continue;
    const value = match[1].replace(/[-/]+$/, '');
    // A number has a digit in it; "Invoice No: Date" does not.
    if (/\d/.test(value) && digitsOnly(value).length < 15) return value.toUpperCase();
  }
  return null;
}

// ─── Date ───────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMERIC_DATE = /(?<!\d)(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})(?!\d)/g;
const NAMED_DATE = /(?<!\d)(\d{1,2})[ \-/.]?([A-Za-z]{3,9})[ \-/.,]*(\d{4}|\d{2})(?!\d)/g;

function toIso(day: number, month: number, yearText: string): string | null {
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 31/02 rolls over; a real date survives the round trip.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function datesIn(line: string): string[] {
  const dates: string[] = [];
  for (const match of line.matchAll(NUMERIC_DATE)) {
    // Bills here are written day first.
    const iso = toIso(Number(match[1]), Number(match[2]), match[3]);
    if (iso) dates.push(iso);
  }
  for (const match of line.matchAll(NAMED_DATE)) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    const iso = month >= 0 ? toIso(Number(match[1]), month + 1, match[3]) : null;
    if (iso) dates.push(iso);
  }
  return dates;
}

export function findBillDate(lines: string[]): string | null {
  const labelled = lines.filter(
    (line) => /\bdate\b|\bdt\b|التاريخ/i.test(line) && !/due|expiry|valid/i.test(line),
  );
  for (const line of [...labelled, ...lines]) {
    const [first] = datesIn(line);
    if (first) return first;
  }
  return null;
}

// ─── Amounts ────────────────────────────────────────────────────────────────

const NUMBER = /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|(?<![\d.,])\d+(?:\.\d{1,3})?/g;

/** Fils. */
const toFils = (text: string) => Math.round(Number(text.replace(/,/g, '')) * 100);
const money = (fils: number) => (fils / 100).toFixed(2);

interface Candidate {
  fils: number;
  /** Lower is more trustworthy. */
  rank: number;
  /** A whole number read where a decimal point may have been lost. */
  lostDecimalOf?: number;
}

/** The amounts on a line, ignoring percentages ("5%", "[5%]") and the TRN. */
function amountsOn(line: string): number[] {
  const cleaned = line
    .replace(TRN_RUN, ' ')
    .replace(/\[?\(?\d+(?:\.\d+)?\s?%\)?\]?/g, ' ')
    .replace(/\[card\]/g, ' ');
  return [...cleaned.matchAll(NUMBER)].map((match) => toFils(match[0]));
}

const SUBTOTAL = [
  /sub\s*-?\s*total/i,
  /taxable\s+(?:amount|amt|value)/i,
  /gross\s+(?:amount|amt)/i,
  /total\s+(?:before|excl\w*|without)\s+(?:vat|tax)/i,
  /amount\s+excl/i,
];
const VAT = [/vat\s+(?:amount|amt)/i, /tax\s+(?:amount|amt)/i, /\bvat\b/i, /ضريبة القيمة/i];
const TOTAL = [
  /grand\s+total/i,
  /total\s+(?:amount|amt)/i,
  /amount\s*:?\s*aed/i,
  /total\s+(?:incl\w*|with)\s+(?:vat|tax)/i,
  /(?:total|amount)\s+(?:due|payable)/i,
  /invoice\s+total/i,
  /\btotal\b/i,
];
/** "Net Amount" is the pre-VAT figure on some bills and the final one on others. */
const NET = /net\s+(?:amount|amt|total)/i;

function collect(lines: string[]) {
  const subtotal: Candidate[] = [];
  const vat: Candidate[] = [];
  const total: Candidate[] = [];
  const push = (list: Candidate[], fils: number, rank: number) => {
    if (!list.some((item) => item.fils === fils)) list.push({ fils, rank });
  };

  lines.forEach((line, index) => {
    if (/vat\s+reg|tax\s+reg|\bTRN\b/i.test(line) && amountsOn(line).length === 0) return;
    const classes: [RegExp[], Candidate[]][] = [
      [SUBTOTAL, subtotal],
      [VAT, vat],
      [TOTAL, total],
    ];
    const isSubtotal = SUBTOTAL.some((pattern) => pattern.test(line));
    for (const [patterns, list] of classes) {
      const rank = patterns.findIndex((pattern) => pattern.test(line));
      if (rank < 0) continue;
      // "Sub Total" also says "total": it is a subtotal only.
      if (list === total && isSubtotal) continue;
      // "Total VAT" is the VAT, not the total.
      if (list === total && /total\s+(?:vat|tax)\b/i.test(line) && !/incl|with/i.test(line))
        continue;
      let amounts = amountsOn(line);
      // The figure sits on the next row when the label fills its own.
      if (
        amounts.length === 0 &&
        index + 1 < lines.length &&
        !/[A-Za-z]{4,}/.test(lines[index + 1])
      ) {
        amounts = amountsOn(lines[index + 1]);
      }
      // The amount is the last figure on the row: the label and any rate come first.
      if (amounts.length > 0) push(list, amounts[amounts.length - 1], rank);
    }
    if (NET.test(line)) {
      const amounts = amountsOn(line);
      if (amounts.length > 0) {
        const fils = amounts[amounts.length - 1];
        push(subtotal, fils, 8);
        push(total, fils, 8);
      }
    }
  });
  return { subtotal, vat, total };
}

/** A whole number of 100 or more may be an amount whose decimal point OCR dropped. */
function withLostDecimals(list: Candidate[]): Candidate[] {
  const extra = list
    .filter((item) => item.fils >= 10000 && item.fils % 100 === 0)
    .map((item) => ({ fils: item.fils / 100, rank: item.rank + 20, lostDecimalOf: item.fils }));
  return [...list, ...extra];
}

const agrees = (subtotal: number, vat: number, total: number) =>
  Math.abs(subtotal + vat - total) <= 5;

export function chooseAmounts(lines: string[]): {
  subtotal: string | null;
  vat: string | null;
  total: string | null;
  warnings: BillWarning[];
} {
  const found = collect(lines);
  const warnings: BillWarning[] = [];

  // 1. All three, as read or with a lost decimal restored, that add up.
  let best: { s: Candidate; v: Candidate; t: Candidate; score: number } | null = null;
  for (const s of withLostDecimals(found.subtotal)) {
    for (const v of withLostDecimals(found.vat)) {
      for (const t of withLostDecimals(found.total)) {
        if (s.fils <= 0 || t.fils <= 0 || v.fils < 0 || v.fils >= s.fils) continue;
        if (!agrees(s.fils, v.fils, t.fils)) continue;
        const score = s.rank + v.rank + t.rank;
        if (!best || score < best.score) best = { s, v, t, score };
      }
    }
  }
  if (best) {
    return {
      subtotal: money(best.s.fils),
      vat: money(best.v.fils),
      total: money(best.t.fils),
      warnings,
    };
  }

  const first = (list: Candidate[]) => [...list].sort((a, b) => a.rank - b.rank)[0] ?? null;
  const s = first(found.subtotal);
  const v = first(found.vat);
  // The total is never the same figure as the subtotal chosen (a "Net Amount").
  const t = first(
    found.total.filter((item) => !s || item.fils !== s.fils || found.total.length === 1),
  );

  // 2. Two of the three: the third follows.
  if (s && t && !v && t.fils >= s.fils) {
    const vat = t.fils - s.fils;
    // VAT here is 5% or nothing; a bigger gap means one of the two was misread.
    if (vat <= Math.round(s.fils * 0.05) + 5) {
      return { subtotal: money(s.fils), vat: money(vat), total: money(t.fils), warnings };
    }
  }
  if (s && v && !t && v.fils < s.fils) {
    return { subtotal: money(s.fils), vat: money(v.fils), total: money(s.fils + v.fils), warnings };
  }
  if (v && t && !s && v.fils < t.fils) {
    return { subtotal: money(t.fils - v.fils), vat: money(v.fils), total: money(t.fils), warnings };
  }

  // 3. Three that don't add up: shown, and flagged for the user to settle.
  if (s && v && t) {
    const reason = `Read as ${money(s.fils)} + ${money(v.fils)} VAT, which isn’t the total ${money(t.fils)}. Check against the bill.`;
    warnings.push(
      { field: 'subtotal', message: reason },
      { field: 'vat', message: reason },
      { field: 'total', message: reason },
    );
    return { subtotal: money(s.fils), vat: money(v.fils), total: money(t.fils), warnings };
  }
  if (s && t) {
    const reason = `Read as ${money(s.fils)} before VAT and ${money(t.fils)} in total, which leaves more than 5% VAT. Check against the bill.`;
    warnings.push({ field: 'subtotal', message: reason }, { field: 'total', message: reason });
    return { subtotal: money(s.fils), vat: null, total: money(t.fils), warnings };
  }

  // 4. One figure alone can't be checked against anything: only a total is kept.
  return { subtotal: null, vat: null, total: t ? money(t.fils) : null, warnings };
}

// ─── Kind of document ───────────────────────────────────────────────────────

const TAX_INVOICE = /tax\s*invoice|فاتورة\s*ضريبية/i;
const CARD_SLIP =
  /approval\s*code|terminal\s*id|merchant\s*id|auth(?:orization|orisation)?\s*(?:code|no)|\bTID\b|\bRRN\b/i;

// ─── Supplier name ──────────────────────────────────────────────────────────

const NOT_A_NAME =
  /tax\s*invoice|invoice|receipt|\bTRN\b|tel|phone|mob|fax|e-?mail|www\.|@|p\.?\s?o\.?\s?box|date|cash|credit|copy|original|customer|bill\s+to|page|\[card\]/i;

export function findSupplierName(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    const letters = line.replace(/[^A-Za-z]/g, '').length;
    if (letters < 4 || letters < digitsOnly(line).length) continue;
    if (NOT_A_NAME.test(line)) continue;
    return line.replace(/^[^A-Za-z]+|[^A-Za-z.)]+$/g, '').slice(0, 80) || null;
  }
  return null;
}

// ─── Item rows ──────────────────────────────────────────────────────────────

const ROW =
  /^(.+?)\s+(\d+(?:\.\d{1,3})?)\s+(?:[A-Za-z]{1,5}\.?\s+)?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+[\d,]+\.\d{2}){0,2}$/;

/** Rows that end quantity / price / amount and multiply out — kept only if they sum to the subtotal. */
export function findLines(lines: string[], subtotal: string | null): ParsedLine[] {
  if (!subtotal) return [];
  const rows: ParsedLine[] = [];
  for (const line of lines) {
    const match = ROW.exec(line);
    if (!match) continue;
    const quantity = Number(match[2]);
    const unitPrice = toFils(match[3]);
    const amount = toFils(match[4]);
    if (quantity <= 0 || Math.abs(Math.round(quantity * unitPrice) - amount) > 5) continue;
    const description = match[1].replace(/^\d{1,3}[.)]?\s+/, '').trim();
    if (description.replace(/[^A-Za-z]/g, '').length < 2) continue;
    rows.push({
      description,
      quantity: match[2],
      unitPrice: money(unitPrice),
      amount: money(amount),
    });
  }
  const sum = rows.reduce((totalFils, row) => totalFils + toFils(row.amount), 0);
  return rows.length > 0 && Math.abs(sum - toFils(subtotal)) <= 5 ? rows : [];
}

// ─── The bill ───────────────────────────────────────────────────────────────

export function parseBill(text: string, options: { ownTrn?: string | null } = {}): ParsedBill {
  const lines = normalise(text);
  const supplierTrn = findSupplierTrn(lines, options.ownTrn);
  const amounts = chooseAmounts(lines);
  const isCardSlip = CARD_SLIP.test(lines.join('\n')) && !supplierTrn;
  const isTaxInvoice =
    !isCardSlip && Boolean(supplierTrn) && lines.some((line) => TAX_INVOICE.test(line));
  return {
    supplierTrn,
    supplierName: findSupplierName(lines),
    headerLines: lines.slice(0, 10),
    billNumber: findBillNumber(lines),
    billDate: findBillDate(lines),
    subtotal: amounts.subtotal,
    vat: amounts.vat,
    total: amounts.total,
    isTaxInvoice,
    isCardSlip,
    lines: findLines(lines, amounts.subtotal),
    warnings: amounts.warnings,
  };
}
