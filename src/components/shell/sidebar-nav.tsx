'use client';

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavList } from '@/components/shell/nav-list';

const COLLAPSE_STORAGE_KEY = 'comet:sidebar-collapsed';

export function SidebarNav() {
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

      <NavList collapsed={collapsed} />

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
