import { toFils } from '@/lib/money';

/*
 * An amount in words, as a payment voucher or a cheque writes it.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–999 in words: "Nine Hundred Seventy-Nine". */
function hundreds(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const rest = n % 100;
  if (rest >= 20) parts.push(`${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ''}`);
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(' ');
}

/** A whole number in words, up to the hundreds of millions. */
function inWords(n: number): string {
  if (n === 0) return 'Zero';
  const scales: [number, string][] = [
    [1_000_000_000, 'Billion'],
    [1_000_000, 'Million'],
    [1_000, 'Thousand'],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      parts.push(`${hundreds(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(hundreds(rest));
  return parts.join(' ');
}

/** "UAE Dirhams Nine Hundred Seventy-Nine and Fils Fifty Only", as vouchers and cheques write it. */
export function aedInWords(amount: string): string {
  const fils = toFils(amount);
  const dirhams = Math.floor(fils / 100);
  const cents = fils % 100;
  return `UAE Dirhams ${inWords(dirhams)}${cents ? ` and Fils ${inWords(cents)}` : ''} Only`;
}
