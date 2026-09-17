'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

/** Submit button that disables itself and shows a spinner while its form's action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  pending: pendingProp,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          {pendingLabel ?? 'Saving…'}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
