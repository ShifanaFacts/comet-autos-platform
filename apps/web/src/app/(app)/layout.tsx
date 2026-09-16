import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/authorize';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { Topbar } from '@/components/shell/topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="text-sm font-semibold tracking-tight">Comet Autos</span>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
