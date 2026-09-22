import Link from 'next/link';
import { KeyRound, Users2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Two halves of one job: the people, and what the roles they hold allow. */
export function AccessTabs({ active }: { active: 'users' | 'roles' }) {
  const tabs = [
    { key: 'users' as const, label: 'Users', href: '/settings/users', icon: Users2 },
    { key: 'roles' as const, label: 'Roles & permissions', href: '/settings/roles', icon: KeyRound },
  ];
  return (
    <nav className="flex gap-1 rounded-xl border border-border bg-card p-1" aria-label="Access management">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
              current
                ? 'bg-foreground text-background'
                : 'text-foreground/70 hover:bg-muted active:bg-muted',
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
