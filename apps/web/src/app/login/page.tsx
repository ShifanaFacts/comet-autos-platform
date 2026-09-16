import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/');
  }

  return (
    <main className="flex min-h-screen">
      <div className="hidden w-[42%] flex-col justify-between bg-sidebar px-10 py-10 text-sidebar-foreground lg:flex">
        <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
          C
        </span>
        <div>
          <p className="text-2xl font-semibold tracking-tight">Comet Autos</p>
          <p className="mt-2 max-w-xs text-sm text-sidebar-foreground/60">
            The workshop operating system for the Al Qusais service center — check-ins, job cards, estimates, and
            invoicing in one place.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/40">Al Qusais, Dubai, UAE</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <h1 className="text-xl font-semibold tracking-tight">Comet Autos</h1>
            <p className="mt-1 text-sm text-muted-foreground">Workshop Management System</p>
          </div>
          <div className="mb-6 hidden lg:block">
            <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter your Comet Autos credentials.</p>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
