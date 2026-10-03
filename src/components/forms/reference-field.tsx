'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { TextField } from '@/components/forms/fields';
import { checkReferenceAction } from '@/app/(app)/finance/reference-actions';
import type { ReferenceMatch } from '@/lib/finance/reference-matches';
import { cn } from '@/lib/utils';

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const NONE = { reference: '', matches: [] as ReferenceMatch[] };

/**
 * A payment reference (cheque, card slip or transfer number). Once it is
 * typed, any live entry already carrying the same reference is shown as a
 * warning — never a block, since one cheque can genuinely pay two things.
 */
export function ReferenceField({
  exceptExpenseId,
  className,
  onBlur,
  onChange,
  ...props
}: ComponentProps<typeof TextField> & {
  /** The expense being edited, so it doesn't warn about itself. */
  exceptExpenseId?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const latest = useRef('');
  const [found, setFound] = useState(NONE);

  // A form reset after saving empties the field without a change event.
  useEffect(() => {
    const form = wrapRef.current?.closest('form');
    if (!form) return;
    const clear = () => {
      latest.current = '';
      setFound(NONE);
    };
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, []);

  async function check(value: string) {
    const reference = normalize(value);
    if (reference.toUpperCase() === latest.current.toUpperCase()) return;
    latest.current = reference;
    if (reference.length < 3) {
      setFound(NONE);
      return;
    }
    try {
      const matches = await checkReferenceAction(reference, exceptExpenseId);
      if (latest.current === reference) setFound({ reference, matches });
    } catch {
      // Only a warning — saving never depends on it.
    }
  }

  // A controlled field can be emptied by its form without any event here.
  const visible =
    found.matches.length > 0 &&
    (props.value === undefined || normalize(props.value).toUpperCase() === found.reference.toUpperCase());

  return (
    <div ref={wrapRef} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <TextField
        {...props}
        className={className}
        onBlur={(event) => {
          onBlur?.(event);
          void check(event.currentTarget.value);
        }}
        onChange={(event) => {
          onChange?.(event);
          if (normalize(event.currentTarget.value).toUpperCase() !== found.reference.toUpperCase()) {
            latest.current = '';
            if (found.matches.length > 0) setFound(NONE);
          }
        }}
      />
      {visible ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <span>
              Reference {found.reference} is already used on{' '}
              {found.matches.length === 1 ? 'this entry' : 'these entries'}. Check it isn&apos;t
              entered twice — you can still save if it&apos;s correct.
            </span>
            <ul className="flex flex-col gap-0.5">
              {found.matches.map((match, index) => (
                <li key={`${match.href}-${index}`}>
                  <Link href={match.href} target="_blank" className="font-medium underline">
                    {match.label}
                  </Link>
                  <span className="text-muted-foreground"> — {match.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
