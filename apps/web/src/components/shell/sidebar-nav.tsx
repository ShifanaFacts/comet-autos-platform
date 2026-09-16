'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from '@/lib/nav';

const COLLAPSE_STORAGE_KEY = 'comet:sidebar-collapsed';

export function SidebarNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Deferred a tick so this doesn't read as a synchronous setState-in-effect
    // (which would cascade an extra render) — it's a one-time hydration of a
    // per-viewer preference, not something worth optimizing further.
    const timeout = setTimeout(() => {
      try {
        setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
      } catch {
        // Private browsing / storage disabled — default to expanded.
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Per-viewer convenience only — fine if it doesn't persist.
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
          C
        </span>
        {!collapsed ? <span className="truncate text-sm font-semibold tracking-tight">Comet Autos</span> : null}
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-4">
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
            {group.label && !collapsed ? (
              <span className="px-2.5 pb-1 text-[10px] font-semibold tracking-widest text-sidebar-foreground/45 uppercase">
                {group.label}
              </span>
            ) : null}
            {group.items.map((item) => {
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-2.5 py-1.5 text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-primary'
                      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed ? 'Collapse' : null}
      </button>
    </aside>
  );
}
