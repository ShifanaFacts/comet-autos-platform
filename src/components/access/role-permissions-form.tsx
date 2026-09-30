'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Panel, Section } from '@/components/layout/primitives';
import type { ActionResult } from '@/lib/errors';
import {
  ACTION_LABELS,
  PERMISSION_ACTIONS,
  permissionLabel,
  type PermissionAction,
} from '@/lib/auth/permission-catalog';
import { updateRolePermissionsAction } from '@/app/(app)/settings/users/actions';
import { cn } from '@/lib/utils';

interface Cell {
  action: PermissionAction;
  label: string;
  code: string;
  detail: string;
  granted: boolean;
}

interface ModuleRow {
  key: string;
  label: string;
  description: string;
  /** One per action, in PERMISSION_ACTIONS order; null where it doesn't exist. */
  cells: (Cell | null)[];
}

/*
 * What a role allows, as a grid: one row per module, one column per action.
 *
 * The rules the ticks follow, so the grid can never say something odd:
 * ticking Create, Edit, Delete, Approve or Export ticks that row's View
 * (you can't edit what you can't open); unticking View clears the rest of
 * the row. A row's own tick is every action on it; a column heading's tick
 * is that action on every module.
 *
 * Read-only for someone who may see roles but not change them, and for the
 * Owner role. Either way the server decides: `updateRolePermissions`
 * refuses an unknown code, the Owner role, or a change that would leave the
 * workshop with nobody able to manage access — and applies the View rule
 * itself whatever the browser sends.
 */
export function RolePermissionsForm({
  roleId,
  modules,
  granted,
  canManage,
}: {
  roleId: string;
  modules: ModuleRow[];
  granted: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(granted));
  const [confirming, setConfirming] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await updateRolePermissionsAction(roleId, prev, formData);
      if (result.ok) {
        toast.success('Permissions saved');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );

  const codesOf = (row: ModuleRow) => row.cells.flatMap((cell) => (cell ? [cell.code] : []));
  const viewOf = (row: ModuleRow) => row.cells[0]?.code ?? null;
  const rowOf = (code: string) => modules.find((row) => codesOf(row).includes(code))!;

  /** Turns codes on or off, keeping the View rule. */
  function apply(codes: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const code of codes) {
        const row = rowOf(code);
        const view = viewOf(row);
        if (on) {
          next.add(code);
          if (view) next.add(view);
        } else if (code === view) {
          for (const other of codesOf(row)) next.delete(other);
        } else {
          next.delete(code);
        }
      }
      return next;
    });
  }

  const columnCodes = (action: PermissionAction) =>
    modules.flatMap((row) => {
      const cell = row.cells[PERMISSION_ACTIONS.indexOf(action)];
      return cell ? [cell.code] : [];
    });

  const initial = new Set(granted);
  const added = [...selected].filter((code) => !initial.has(code));
  const removed = granted.filter((code) => !selected.has(code));
  const dirty = added.length > 0 || removed.length > 0;

  const grid = (
    <>
      {/* Desktop and tablet: the grid. */}
      <Panel padding="none" className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-184 text-sm">
          <thead className="bg-muted/40">
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left font-medium">Module</th>
              {PERMISSION_ACTIONS.map((action) => {
                const codes = columnCodes(action);
                const on = codes.filter((code) => selected.has(code)).length;
                return (
                  <th key={action} className="w-24 px-2 py-3 text-center font-medium">
                    <label className="flex flex-col items-center gap-1.5">
                      <span>{ACTION_LABELS[action]}</span>
                      {canManage ? (
                        <TickBox
                          checked={on === codes.length && codes.length > 0}
                          mixed={on > 0 && on < codes.length}
                          onChange={(value) => apply(codes, value)}
                          label={`${ACTION_LABELS[action]} on every module`}
                        />
                      ) : null}
                    </label>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {modules.map((row) => {
              const codes = codesOf(row);
              const on = codes.filter((code) => selected.has(code)).length;
              return (
                <tr key={row.key} className={cn(on > 0 && 'bg-primary/2.5')}>
                  <td className="px-4 py-3">
                    <label className="flex items-start gap-3">
                      {canManage ? (
                        <TickBox
                          checked={on === codes.length}
                          mixed={on > 0 && on < codes.length}
                          onChange={(value) => apply(codes, value)}
                          label={`Everything on ${row.label}`}
                          className="mt-0.5"
                        />
                      ) : null}
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{row.label}</span>
                        <span className="text-xs text-muted-foreground">{row.description}</span>
                      </span>
                    </label>
                  </td>
                  {row.cells.map((cell, index) =>
                    cell ? (
                      <td key={cell.code} className="px-2 py-3 text-center" title={cell.detail}>
                        <TickBox
                          checked={selected.has(cell.code)}
                          disabled={!canManage}
                          onChange={(value) => apply([cell.code], value)}
                          label={`${row.label}: ${cell.label}. ${cell.detail}`}
                        />
                      </td>
                    ) : (
                      <td key={index} className="px-2 py-3" aria-hidden />
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Phone: one card per module, its actions as a row of toggles. */}
      <div className="flex flex-col gap-3 md:hidden">
        {modules.map((row) => {
          const codes = codesOf(row);
          const on = codes.filter((code) => selected.has(code)).length;
          return (
            <Panel key={row.key} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold">{row.label}</span>
                  <span className="text-xs text-muted-foreground">{row.description}</span>
                </span>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => apply(codes, on !== codes.length)}
                    className="h-9 shrink-0 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
                  >
                    {on === codes.length ? 'None' : 'All'}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {row.cells.map((cell) =>
                  cell ? (
                    <button
                      key={cell.code}
                      type="button"
                      role="switch"
                      aria-checked={selected.has(cell.code)}
                      disabled={!canManage}
                      onClick={() => apply([cell.code], !selected.has(cell.code))}
                      className={cn(
                        'h-10 min-w-18 rounded-full border px-3 text-sm font-medium transition-colors disabled:cursor-default',
                        selected.has(cell.code)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-muted-foreground',
                      )}
                    >
                      {cell.label}
                    </button>
                  ) : null,
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );

  if (!canManage) {
    return (
      <Section title="What this role allows" description={`${granted.length} permissions.`}>
        {grid}
      </Section>
    );
  }

  return (
    <Section
      title="What this role allows"
      description="Tick what someone holding this role may do. It takes effect the next time they load a page."
    >
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        {[...selected].map((code) => (
          <input key={code} type="hidden" name="permissions" value={code} />
        ))}
        {grid}
        <FormError message={state.error} />
        {/* Sticky on a phone: the list is long and the save must stay reachable. */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 rounded-xl border border-border bg-background/95 p-3 backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <p className="text-xs text-muted-foreground">
            {dirty
              ? `Unsaved: ${added.length} added, ${removed.length} removed.`
              : `${selected.size} permissions ticked.`}
          </p>
          <Button
            type="button"
            size="lg"
            className="h-12 w-full sm:h-11 sm:w-auto"
            disabled={!dirty || isPending}
            onClick={() => setConfirming(true)}
          >
            <Save />
            Save changes
          </Button>
        </div>
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Save these changes?</DialogTitle>
            <DialogDescription>
              Everyone holding this role gets the new access on their next page load. The change is
              recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <ChangeList title="Added" icon={<Plus className="size-4 text-success" />} codes={added} />
          <ChangeList
            title="Removed"
            icon={<Minus className="size-4 text-destructive" />}
            codes={removed}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <SubmitButton
              pending={isPending}
              pendingLabel="Saving…"
              onClick={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
              type="button"
            >
              Save changes
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ChangeList({
  title,
  icon,
  codes,
}: {
  title: string;
  icon: React.ReactNode;
  codes: string[];
}) {
  if (codes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {title} ({codes.length})
      </p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {codes.map((code) => (
          <li key={code} className="flex items-center gap-2">
            {icon}
            {permissionLabel(code)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A tick box that can also show "some of these" (the dash state). */
function TickBox({
  checked,
  mixed = false,
  disabled = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      ref={(element) => {
        if (element) element.indeterminate = mixed;
      }}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className={cn('size-5 shrink-0 accent-primary disabled:opacity-70', className)}
    />
  );
}
