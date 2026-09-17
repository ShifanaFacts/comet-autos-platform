import { ChevronDown, LogOut, MapPin } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from '@/components/shell/global-search';
import { MobileNav } from '@/components/shell/mobile-nav';
import { CONTAINER_X } from '@/components/layout/primitives';
import { cn } from '@/lib/utils';
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
    <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className={cn(CONTAINER_X, 'flex h-full items-center gap-4')}>
        <MobileNav />
        <div className="min-w-0 flex-1">
          <GlobalSearch />
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {branchName ? (
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <MapPin className="size-4" />
              {branchName}
            </span>
          ) : null}
          {branchName ? <span className="hidden h-6 w-px bg-border sm:block" aria-hidden /> : null}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials(user.fullName)}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-medium lg:block">{user.fullName}</span>
              <ChevronDown className="hidden size-4 text-muted-foreground lg:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
        </div>
      </div>
    </header>
  );
}
