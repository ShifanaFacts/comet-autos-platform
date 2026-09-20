import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Layout primitives. They encode the app's spacing rhythm (see the note in
 * globals.css) so pages compose structure instead of picking gap/padding
 * values ad hoc:
 *
 *   small    4px / 8px     → xs / sm
 *   normal   12px / 16px   → md / base
 *   section  24px / 32px   → lg / xl
 *   major    40px / 48px   → 2xl / 3xl
 */

const GAP = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  base: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
  '2xl': 'gap-10',
  '3xl': 'gap-12',
} as const;

export type Gap = keyof typeof GAP;

/** Shared horizontal gutter + max width. The top bar reuses it so the search box lines up with page titles. */
export const CONTAINER_X = 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10';

/** The one content frame every app page renders inside (applied once, in the (app) layout). */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(CONTAINER_X, 'pt-8 pb-12 lg:pt-10 lg:pb-16', className)}>{children}</div>
  );
}

/** Vertical rhythm between siblings. Pages use `2xl` between major blocks. */
export function Stack({
  gap = 'base',
  as: Component = 'div',
  className,
  children,
}: {
  gap?: Gap;
  as?: 'div' | 'section' | 'ul' | 'ol' | 'dl';
  className?: string;
  children: ReactNode;
}) {
  return <Component className={cn('flex flex-col', GAP[gap], className)}>{children}</Component>;
}

/** A grid with a rhythm-aligned gap. Column templates are passed via className (e.g. `xl:grid-cols-12`). */
export function Grid({
  gap = 'lg',
  className,
  children,
}: {
  gap?: Gap;
  className?: string;
  children: ReactNode;
}) {
  // grid-cols-1 by default: without it the implicit column is sized to its
  // widest content, which pushes wide tables past the screen on tablets.
  return <div className={cn('grid grid-cols-1', GAP[gap], className)}>{children}</div>;
}

/** Top of every page: optional eyebrow, title, description, and primary actions, separated from content by a rule. */
export function PageHeader({
  eyebrow,
  title,
  description,
  leading,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Visual anchor rendered before the title block, e.g. a vehicle plate. */
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 flex-col gap-3">
        {eyebrow ? (
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex min-w-0 items-start gap-4">
          {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="flex flex-wrap items-center gap-3 text-[28px] leading-[1.15] font-semibold tracking-[-0.022em] text-balance text-foreground sm:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  step,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Position in an ordered run of sections — shown as a numbered marker. */
  step?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {step !== undefined ? (
          <span
            aria-hidden
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[12px] font-semibold text-accent-foreground tabular-nums"
          >
            {step}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.011em] text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {/* On a phone the section's link is a real tap target, not a 20px line of text. */}
      {action ? (
        <div className="shrink-0 text-sm [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center md:[&_a]:min-h-0">
          {action}
        </div>
      ) : null}
    </div>
  );
}

/** A titled block of content. Title → content is always 16px; blocks are separated by the parent Stack. */
export function Section({
  title,
  description,
  action,
  step,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Position in an ordered run of sections — shown as a numbered marker. */
  step?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <SectionHeader title={title} description={description} action={action} step={step} />
      {children}
    </section>
  );
}

const PANEL_PADDING = {
  none: '',
  base: 'p-4 sm:p-6',
} as const;

/** A raised surface. Use for content that needs its own boundary (lists, forms, dense data) — not for every section. */
export function Panel({
  padding = 'base',
  className,
  children,
}: {
  padding?: keyof typeof PANEL_PADDING;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-border/70 bg-card shadow-card',
        PANEL_PADDING[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}
