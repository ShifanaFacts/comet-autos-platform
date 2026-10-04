'use client';

import { NativeSelect } from '@/components/forms/fields';
import type { SearchableSelectProps } from '@/components/forms/searchable-select';

/*
 * VAT chosen from a list rather than typed: the workshop's standard rate or
 * none. Where the tax codes are offered, they are the list instead — this is
 * for a rate on its own (a part's VAT), and for forms whose tax codes have
 * all been switched off.
 */

/** "5.00" → "5", blank → "0"; '' when it isn't a number. */
function plainRate(rate: string): string {
  const text = rate.trim();
  if (!text) return '0';
  const value = Number(text);
  return Number.isFinite(value) ? String(value) : '';
}

/** The standard rate and none — plus `current`, so a value saved at another rate keeps it. */
function rateChoices(standard: string, current: string | undefined): string[] {
  const rates = [standard, '0', current === undefined ? '' : plainRate(current)];
  return [...new Set(rates.filter(Boolean))];
}

export function VatRateSelect({
  standardRate,
  value,
  defaultValue,
  ...props
}: Omit<SearchableSelectProps, 'children' | 'value' | 'defaultValue'> & {
  /** The workshop's rate, from Settings. */
  standardRate: string;
  value?: string;
  defaultValue?: string;
}) {
  const standard = plainRate(standardRate) || '0';
  const current = value ?? defaultValue;
  const selected = (rate: string | undefined) =>
    rate === undefined ? undefined : plainRate(rate) || standard;
  return (
    <NativeSelect {...props} value={selected(value)} defaultValue={selected(defaultValue)}>
      {rateChoices(standard, current).map((rate) => (
        <option key={rate} value={rate}>
          {rate}%{rate === '0' ? ' — no VAT' : rate === standard ? ' — standard rate' : ''}
        </option>
      ))}
    </NativeSelect>
  );
}
