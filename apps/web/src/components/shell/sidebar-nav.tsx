'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from '@/lib/nav';

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 px-3 py-4">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
          {group.label ? (
            <span className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </span>
          ) : null}
          {group.items.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
