import type { z } from 'zod';
import { DomainError } from '@/lib/errors';

/** FormData -> plain object (last value wins), for zod parsing. */
export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

export class ValidationError extends DomainError {
  constructor(readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] ?? 'Please check the highlighted fields.');
    this.name = 'ValidationError';
  }
}

/** Parses with zod and throws a ValidationError carrying every field's first message. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new ValidationError(fieldErrors);
}
