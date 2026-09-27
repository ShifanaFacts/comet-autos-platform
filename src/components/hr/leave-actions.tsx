'use client';

import { Ban, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReasonAction } from '@/components/shared/reason-action';
import { cancelLeaveAction, decideLeaveAction } from '@/app/(app)/hr/leave/actions';

/** Approve / reject a pending request, and withdraw a live one. */
export function LeaveActions({
  leaveId,
  employeeName,
  status,
  canApprove,
  canCancel,
}: {
  leaveId: string;
  employeeName: string;
  status: string;
  canApprove: boolean;
  canCancel: boolean;
}) {
  const pending = status === 'PENDING';
  const live = pending || status === 'APPROVED';
  // Withdrawing approved leave takes the same authority that approved it.
  const mayCancel = live && canCancel && (pending || canApprove);

  if (!(pending && canApprove) && !mayCancel) return null;

  return (
    <span className="flex flex-wrap gap-2">
      {pending && canApprove ? (
        <>
          <ReasonAction
            trigger={
              <Button size="sm" className="h-11 sm:h-8">
                <Check />
                Approve
              </Button>
            }
            title={`Approve ${employeeName}'s leave?`}
            description="They will be shown as on leave for these days, and unpaid leave is deducted in the payroll run."
            confirmLabel="Approve"
            reasonLabel="Note"
            requireReason={false}
            tone="default"
            successMessage="Leave approved"
            onConfirm={(input) => decideLeaveAction(leaveId, 'APPROVED', input)}
          />
          <ReasonAction
            trigger={
              <Button variant="outline" size="sm" className="h-11 sm:h-8">
                <X />
                Reject
              </Button>
            }
            title={`Reject ${employeeName}'s leave?`}
            description="The request is kept, marked rejected, with your reason."
            confirmLabel="Reject"
            placeholder="e.g. Two technicians are already off that week"
            successMessage="Leave rejected"
            onConfirm={(input) => decideLeaveAction(leaveId, 'REJECTED', input)}
          />
        </>
      ) : null}
      {mayCancel ? (
        <ReasonAction
          trigger={
            <Button variant="ghost" size="sm" className="h-11 text-muted-foreground sm:h-8">
              <Ban />
              Cancel
            </Button>
          }
          title="Cancel this leave?"
          description={`${employeeName} is no longer off for these days. The record is kept, marked cancelled.`}
          confirmLabel="Cancel leave"
          placeholder="e.g. Trip postponed"
          successMessage="Leave cancelled"
          onConfirm={(input) => cancelLeaveAction(leaveId, input)}
        />
      ) : null}
    </span>
  );
}
