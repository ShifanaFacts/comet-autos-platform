import { PageHeader } from '@/components/shell/page-header';
import { CheckInForm } from './check-in-form';

export default function CheckInPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Quick Check-In" description="Find the vehicle, note the complaint, and check it in." />
      <CheckInForm />
    </div>
  );
}
