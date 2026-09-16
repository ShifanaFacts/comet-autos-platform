import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Comet Autos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Workshop Management System</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
