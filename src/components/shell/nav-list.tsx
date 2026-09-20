'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from '@/lib/nav';

export function NavList({
  allowedHrefs,
  collapsed = false,
  onNavigate,
}: {
  /** Items the signed-in user may see (decided on the server from their permissions). */
  allowedHrefs: string[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = new Set(allowedHrefs);
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed.has(item.href)),
  })).filter((group) => group.items.length > 0);

  return (
    <nav
      className={cn(
        'scrollbar-none relative flex flex-1 flex-col gap-6 overflow-y-auto py-5',
        collapsed ? 'px-3' : 'px-3',
      )}
    >
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
          {group.label && !collapsed ? (
            <span className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/40 uppercase">
              {group.label}
            </span>
          ) : null}
          {group.label && collapsed && index > 0 ? (
            <span className="mx-auto mb-2 h-px w-6 bg-sidebar-border" aria-hidden />
          ) : null}
          {group.items.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group/nav relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  'transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none',
                  collapsed && 'justify-center px-0',
                  item.soon && !isActive && 'text-sidebar-foreground/45',
                  isActive
                    ? 'bg-gradient-to-r from-sidebar-primary/30 to-sidebar-primary/10 text-sidebar-foreground ring-1 ring-sidebar-primary/30 ring-inset'
                    : 'text-sidebar-foreground/75 hover:translate-x-0.5 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'size-[18px] shrink-0 transition-colors',
                    isActive
                      ? 'text-violet-400'
                      : 'text-sidebar-foreground/55 group-hover/nav:text-sidebar-foreground/90',
                  )}
                />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
                {!collapsed && item.soon ? (
                  <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/50">
                    Soon
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
