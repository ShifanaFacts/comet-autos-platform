'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Panel, Section } from '@/components/layout/primitives';
import type { ActionResult } from '@/lib/errors';
import { updateRolePermissionsAction } from '@/app/(app)/settings/users/actions';
import { cn } from '@/lib/utils';

interface ModuleView {
  key: string;
  label: string;
  covers: string;
  permissions: { code: string; label: string; detail: string; granted: boolean }[];
  grantedCount: number;
}

/*
 * What a role allows, grouped the way the workshop thinks about it.
 *
 * Read-only for someone who may see roles but not change them, and for
 * built-in roles. Either way the server decides: this form posts the codes
 * it was given and `updateRolePermissions` refuses anything it shouldn't
 * accept — an unknown code, a built-in role, or a change that would leave
 * the workshop with nobody able to manage access.
 */
export function RolePermissionsForm({
  roleId,
  modules,
  granted,
  canManage,
}: {
  roleId: string;
  modules: ModuleView[];
  granted: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(granted));
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

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModule(module: ModuleView) {
    const codes = module.permissions.map((permission) => permission.code);
    const allOn = codes.every((code) => selected.has(code));
    setSelected((current) => {
      const next = new Set(current);
      for (const code of codes) {
        if (allOn) next.delete(code);
        else next.add(code);
      }
      return next;
    });
  }

  const dirty =
    selected.size !== granted.length || granted.some((code) => !selected.has(code));

  const body = (
    <div className="flex flex-col gap-3">
      {modules.map((module) => {
        const codes = module.permissions.map((permission) => permission.code);
        const on = codes.filter((code) => selected.has(code)).length;
        return (
          <Panel key={module.key} padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3.5 sm:px-6">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold">{module.label}</span>
                <span className="text-xs text-muted-foreground">{module.covers}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {on}/{codes.length}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => toggleModule(module)}
                    className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
                  >
                    {on === codes.length ? 'Clear all' : 'Select all'}
                  </button>
                ) : null}
              </div>
            </div>
            <ul className="divide-y divide-border">
              {module.permissions.map((permission) => {
                const checked = selected.has(permission.code);
                if (!canManage) {
                  return (
                    <li
                      key={permission.code}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3.5 sm:px-6',
                        !checked && 'opacity-45',
                      )}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          checked ? 'text-success' : 'text-muted-foreground/40',
                        )}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{permission.label}</span>
                        <span className="text-xs text-muted-foreground">{permission.detail}</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={permission.code}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-6',
                        checked && 'bg-primary/[0.03]',
                      )}
                    >
                      <input
                        type="checkbox"
                        name="permissions"
                        value={permission.code}
                        checked={checked}
                        onChange={() => toggle(permission.code)}
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{permission.label}</span>
                        <span className="text-xs text-muted-foreground">{permission.detail}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </div>
  );

  if (!canManage) {
    return (
      <Section
        title="What this role allows"
        description={`${granted.length} permissions.`}
      >
        {body}
      </Section>
    );
  }

  return (
    <Section
      title="What this role allows"
      description="Tick what someone holding this role may do. It takes effect the next time they load a page."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {body}
        <FormError message={state.error} />
        {/* Sticky on a phone: the list is long and the save must stay reachable. */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 rounded-xl border border-border bg-background/95 p-3 backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <p className="text-xs text-muted-foreground">
            {dirty ? 'Unsaved changes.' : `${selected.size} permissions selected.`}
          </p>
          <SubmitButton
            pending={isPending}
            size="lg"
            className="h-12 w-full sm:h-11 sm:w-auto"
            pendingLabel="Saving…"
            disabled={!dirty}
          >
            <Save />
            Save permissions
          </SubmitButton>
        </div>
      </form>
    </Section>
  );
}
