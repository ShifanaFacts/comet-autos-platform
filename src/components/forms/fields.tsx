import type { ComponentProps, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CONTROL } from '@/components/forms/control';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { NumberInput, type NumberKind } from '@/components/forms/number-input';

/** Label → control (8px) → hint/error (8px). Fields are stacked 24px apart by their parent form. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A labelled input. Its id defaults to its name; pass `id` when the same
 * field name appears twice on a page (two forms, or a form in a dialog).
 */
export function TextField({
  id,
  label,
  name,
  error,
  hint,
  required,
  className,
  numeric,
  allowNegative,
  ...inputProps
}: Omit<ComponentProps<'input'>, 'name'> & {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: ReactNode;
  /** A number field: money, a quantity, a rate or hours, in the app's one standard. */
  numeric?: NumberKind;
  /** With `numeric`: a figure that can be below zero. */
  allowNegative?: boolean;
}) {
  const inputId = id ?? name;
  const control = {
    id: inputId,
    name,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${inputId}-error` : undefined,
  } as const;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      {numeric ? (
        <NumberInput
          {...control}
          {...(inputProps as ComponentProps<typeof NumberInput>)}
          kind={numeric}
          allowNegative={allowNegative}
        />
      ) : (
        <Input {...control} {...inputProps} />
      )}
    </Field>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(CONTROL, 'min-h-24 py-2 leading-relaxed', className)} {...props} />
  );
}

/** A labelled textarea. Like TextField, its id defaults to its name. */
export function TextareaField({
  id,
  label,
  name,
  error,
  hint,
  required,
  className,
  ...props
}: Omit<ComponentProps<'textarea'>, 'name'> & {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: ReactNode;
}) {
  const inputId = id ?? name;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <Textarea
        id={inputId}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
    </Field>
  );
}

/**
 * The app's dropdown. Written like a `<select>` with `<option>`s; shown as a
 * searchable list — see SearchableSelect.
 */
export function NativeSelect(props: ComponentProps<'select'>) {
  return <SearchableSelect {...props} />;
}

/** Form-level error banner. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {message}
    </div>
  );
}
