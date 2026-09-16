import { Button } from '@/components/ui/button';
import { logout } from '@/lib/auth/logout-action';
import type { AuthenticatedUser } from '@/lib/auth/session';

export function Topbar({ user }: { user: AuthenticatedUser }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{user.fullName}</span>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
