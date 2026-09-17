import { PageHeader } from '@/components/shell/page-header';
import { CheckInForm } from './check-in-form';

export default function CheckInPage() {
  return (
    <div className="animate-in fade-in mx-auto max-w-lg duration-300">
      <PageHeader title="Quick Check-In" description="Find the vehicle, note the complaint, and check it in." />
      <CheckInForm />
    </div>
  );
}
