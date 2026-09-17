import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** A navigation link styled as a Button. */
export function LinkButton({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'render' | 'nativeButton'> & { href: string; children: ReactNode }) {
  return (
    <Button nativeButton={false} render={<Link href={href} />} {...props}>
      {children}
    </Button>
  );
}
