import { LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from '@/components/shell/global-search';
import { logout } from '@/lib/auth/logout-action';
import type { AuthenticatedUser } from '@/lib/auth/session';

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function Topbar({ user, branchName }: { user: AuthenticatedUser; branchName: string | null }) {
  return (
    <header className="flex h-16 items-center gap-4 border-b border-border bg-background px-6">
      <div className="flex-1">
        <GlobalSearch />
      </div>

      {branchName ? (
        <span className="hidden shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground sm:inline">
          {branchName}
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials(user.fullName)}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>
            <span className="block truncate font-medium">{user.fullName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form action={logout}>
            <DropdownMenuItem render={<button type="submit" className="w-full" />} variant="destructive">
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
