'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { setHiddenMenusAction } from '@/app/(app)/settings/actions';
import { ALWAYS_SHOWN_MENUS, NAV_GROUPS, STANDARD_JOB_CARD_MENUS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Which menus the workshop sees. Each switch saves as it is flipped. Some
 * are fixed: the ones the app can't be used without, and the standard job
 * card's own screens while the minimal job card is on.
 *
 * Saving redraws the menu around every page, which takes a moment: the
 * switch that was flipped shows a spinner until it is done, and the others
 * wait (two saves at once would race each other) without greying out, so
 * the screen never looks frozen.
 */
export function MenusForm({
  hiddenMenus,
  detailedJobCards,
  canEdit,
}: {
  hiddenMenus: string[];
  detailedJobCards: boolean;
  canEdit: boolean;
}) {
  const [hidden, setHidden] = useState(hiddenMenus);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(href: string, label: string, show: boolean) {
    const previous = hidden;
    const next = show ? hidden.filter((h) => h !== href) : [...hidden, href];
    setError(null);
    setHidden(next);
    setSaving(href);
    startTransition(async () => {
      // The action revalidates the layout, so its response already carries
      // the redrawn menu — no second refresh is needed.
      const result = await setHiddenMenusAction(next);
      setSaving(null);
      if (result.ok) {
        toast.success(show ? `${label} shown` : `${label} hidden`);
      } else {
        setHidden(previous);
        setError(result.error ?? 'Could not change the menus.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {NAV_GROUPS.map((group, index) => (
        <div
          key={group.label ?? `group-${index}`}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          {group.label ? (
            <p className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-6">
              {group.label}
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {group.items.map((item) => {
              const Icon = item.icon;
              const locked = ALWAYS_SHOWN_MENUS.includes(item.href);
              const standardOnly = !detailedJobCards && STANDARD_JOB_CARD_MENUS.includes(item.href);
              const shown = locked || (!standardOnly && !hidden.includes(item.href));
              const note =
                saving === item.href
                  ? 'Saving…'
                  : locked
                    ? 'Always shown'
                    : standardOnly
                      ? 'Shown with the standard job card'
                      : item.soon
                        ? 'Coming soon'
                        : null;
              return (
                <li
                  key={item.href}
                  className="flex min-h-14 items-center justify-between gap-4 px-4 py-2 sm:px-6"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{item.label}</span>
                      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
                    </span>
                  </span>
                  <MenuSwitch
                    label={item.label}
                    checked={shown}
                    disabled={!canEdit || locked || standardOnly}
                    busy={isPending}
                    saving={saving === item.href}
                    onChange={(show) => toggle(item.href, item.label, show)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MenuSwitch({
  label,
  checked,
  disabled,
  busy,
  saving,
  onChange,
}: {
  label: string;
  checked: boolean;
  /** Can't be changed at all — shown dimmed. */
  disabled: boolean;
  /** Another save is running — this one waits, but stays at full strength. */
  busy: boolean;
  /** This switch's own save is running. */
  saving: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Show ${label}`}
      aria-busy={saving || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2',
        disabled ? 'cursor-not-allowed opacity-50' : busy ? 'cursor-wait' : null,
      )}
    >
      {saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      <span
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-background shadow-sm transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
