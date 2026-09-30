'use client';

import type { ChangeEvent, ComponentProps, FocusEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * Every number typed into the app, in one standard: digits and one "." for
 * the decimal point — no commas, no spaces, no letters — right-aligned in
 * even-width figures so columns of them line up.
 *
 *   money     two decimals, always shown once the box is left: 250 → 250.00
 *   quantity  up to three decimals, as typed: 2, 1.5, 0.250
 *   rate      a percentage, up to two decimals: 5, 12.5
 *   hours     up to two decimals: 2.5
 *
 * The normal keyboard opens, not the number pad — some phones' number pads
 * have no "." key.
 */

export type NumberKind = 'money' | 'quantity' | 'rate' | 'hours';

const DECIMALS: Record<NumberKind, number> = { money: 2, quantity: 3, rate: 2, hours: 2 };

/** What may be typed: digits, one ".", and a leading "-" when allowed. */
export function cleanNumber(value: string, kind: NumberKind, negative = false) {
  const minus = negative && value.trim().startsWith('-');
  let text = value.replace(/[^\d.]/g, '');
  const dot = text.indexOf('.');
  if (dot >= 0) {
    text =
      text.slice(0, dot + 1) +
      text
        .slice(dot + 1)
        .replace(/\./g, '')
        .slice(0, DECIMALS[kind]);
  }
  if (text.startsWith('.')) text = `0${text}`;
  return minus ? `-${text}` : text;
}

/** The standard written form once typing is done: money to two decimals. */
export function finishNumber(value: string, kind: NumberKind) {
  const text = value.trim();
  if (!text || text === '-' || !/^-?\d+(\.\d*)?$/.test(text)) return text;
  const negative = text.startsWith('-');
  let [whole, fraction = ''] = text.replace('-', '').split('.');
  whole = whole.replace(/^0+(?=\d)/, '');
  if (kind === 'money') fraction = fraction.padEnd(2, '0');
  const out = fraction ? `${whole}.${fraction}` : whole;
  return negative && Number(out) !== 0 ? `-${out}` : out;
}

/** Sets an input's value the way typing would, so React's onChange sees it. */
function setTyped(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function NumberInput({
  kind = 'money',
  allowNegative = false,
  className,
  onChange,
  onBlur,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'inputMode'> & {
  kind?: NumberKind;
  /** A figure that can be below zero, e.g. an overdrawn bank balance. */
  allowNegative?: boolean;
}) {
  return (
    <Input
      autoComplete="off"
      spellCheck={false}
      {...props}
      // After the props: the text keyboard, whatever was passed.
      type="text"
      inputMode="text"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const clean = cleanNumber(event.target.value, kind, allowNegative);
        if (clean !== event.target.value) event.target.value = clean;
        onChange?.(event);
      }}
      onBlur={(event: FocusEvent<HTMLInputElement>) => {
        const finished = finishNumber(event.target.value, kind);
        if (finished !== event.target.value) setTyped(event.target, finished);
        onBlur?.(event);
      }}
      className={cn('text-right tabular-nums', className)}
    />
  );
}
