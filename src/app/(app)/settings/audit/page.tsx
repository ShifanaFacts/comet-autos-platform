import Link from 'next/link';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, History } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import {
  getAuditFilterOptions,
  listAuditLog,
  type AuditEntry,
  type AuditFilters,
} from '@/lib/access/audit';
import { formatDateTime } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/forms/fields';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/*
 * The audit log: who did what, and when. Read-only — nothing on this page
 * (or anywhere) can change or remove an entry, and the database refuses to.
 * The filters live in the URL, so a filtered view can be bookmarked or
 * handed to someone, and the download holds exactly those rows.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditFilters>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'audit.view')) return <AccessDenied what="the audit log" />;
  const params = await searchParams;
  const filters: AuditFilters = {
    from: params.from || undefined,
    to: params.to || undefined,
    who: params.who || undefined,
    module: params.module || undefined,
    type: params.type || undefined,
    page: params.page || undefined,
  };
  const [log, options] = await Promise.all([
    listAuditLog(user, filters),
    getAuditFilterOptions(user),
  ]);
  const canExport = hasPermission(user, 'audit.export');

  const query = (extra: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...extra })) {
      if (value) search.set(key, value);
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  };
  const filtered = Boolean(
    filters.from || filters.to || filters.who || filters.module || filters.type,
  );

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Settings"
        title="Audit log"
        description="Every change made in the system — who, when, and what it was before and after. Entries can never be edited or deleted."
        actions={
          canExport ? (
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              render={<a href={`/settings/audit/export${query({ page: undefined })}`} />}
            >
              <Download />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <Panel>
        <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <label className="flex flex-col gap-2 text-sm font-medium">
            From
            <Input type="date" name="from" defaultValue={filters.from} className="h-11" />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            To
            <Input type="date" name="to" defaultValue={filters.to} className="h-11" />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Person
            <NativeSelect name="who" defaultValue={filters.who ?? ''} className="h-11">
              <option value="">Everyone</option>
              {options.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Module
            <NativeSelect name="module" defaultValue={filters.module ?? ''} className="h-11">
              <option value="">All modules</option>
              {options.modules.map((module) => (
                <option key={module.key} value={module.key}>
                  {module.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Type
            <NativeSelect name="type" defaultValue={filters.type ?? ''} className="h-11">
              <option value="">Every kind</option>
              {options.types.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1">
              Apply
            </Button>
            {filtered ? (
              <LinkButton href="/settings/audit" variant="ghost" className="h-11">
                Clear
              </LinkButton>
            ) : null}
          </div>
        </form>
      </Panel>

      <p className="text-sm text-muted-foreground">
        {log.total === 0
          ? 'No entries.'
          : `${log.total} ${log.total === 1 ? 'entry' : 'entries'}, newest first. Amber rows are sensitive: reversals, voids, cancellations, deletions, credit notes, manual journals, merges, and changes to users and roles.`}
      </p>

      {log.entries.length === 0 ? (
        <EmptyState
          icon={History}
          title={filtered ? 'Nothing matches these filters' : 'Nothing recorded yet'}
          description={
            filtered
              ? 'Widen the dates or clear a filter.'
              : 'Every change anyone makes will be listed here.'
          }
        />
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <ul className="divide-y divide-border">
            {log.entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </Panel>
      )}

      {log.pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          {log.page > 1 ? (
            <LinkButton
              href={`/settings/audit${query({ page: String(log.page - 1) })}`}
              variant="outline"
            >
              <ChevronLeft />
              Newer
            </LinkButton>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {log.page} of {log.pages}
          </span>
          {log.page < log.pages ? (
            <LinkButton
              href={`/settings/audit${query({ page: String(log.page + 1) })}`}
              variant="outline"
            >
              Older
              <ChevronRight />
            </LinkButton>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </Stack>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const changes = diff(entry.before, entry.after);
  const details = flatten(entry.metadata);
  return (
    <li
      className={cn(
        'flex flex-col gap-2 px-4 py-4 sm:px-6',
        entry.sensitive && 'border-l-4 border-l-warning bg-warning/10',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex min-w-0 items-start gap-2 text-sm font-medium">
          {entry.sensitive ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Sensitive" />
          ) : null}
          <span>{entry.sentence}</span>
        </p>
        {entry.href ? (
          <Link
            href={entry.href}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            Open record
          </Link>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(entry.at)} · {entry.who}
        <span className="ml-2 font-mono opacity-70">{entry.action}</span>
      </p>
      {changes.length > 0 || details.length > 0 ? (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
            Before and after
          </summary>
          <div className="mt-3 overflow-x-auto">
            {changes.length > 0 ? (
              <table className="w-full min-w-120 text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="w-1/4 py-1 pr-3 font-medium">Field</th>
                    <th className="w-3/8 py-1 pr-3 font-medium">Before</th>
                    <th className="w-3/8 py-1 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {changes.map((row) => (
                    <tr key={row.key} className={cn(row.changed && 'bg-primary/5')}>
                      <td className="py-1.5 pr-3 align-top font-medium">{row.key}</td>
                      <td className="py-1.5 pr-3 align-top break-all text-muted-foreground">
                        {row.before}
                      </td>
                      <td className="py-1.5 align-top break-all">{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {details.length > 0 ? (
              <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                {details.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-medium text-muted-foreground">{key}</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

function show(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const asRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Every field that appears before or after, with whether it changed. */
function diff(before: unknown, after: unknown) {
  const was = asRecord(before);
  const now = asRecord(after);
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];
  return keys.map((key) => ({
    key,
    before: key in was ? show(was[key]) : '',
    after: key in now ? show(now[key]) : '',
    changed: show(was[key]) !== show(now[key]),
  }));
}

function flatten(value: unknown): [string, string][] {
  return Object.entries(asRecord(value))
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, show(item)]);
}
