import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { Topbar } from '@/components/shell/topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const branch = user.primaryBranchId
    ? await prisma.branch.findUnique({ where: { id: user.primaryBranchId }, select: { name: true } })
    : null;

  return (
    <div className="flex min-h-screen">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} branchName={branch?.name ?? null} />
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
