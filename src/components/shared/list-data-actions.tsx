'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, Loader2, MoreHorizontal, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import type { ImportColumn, ImportOutcome } from '@/lib/data-transfer/imports';
import { importCsvAction } from '@/app/(app)/import/actions';
import { exportGuideAction } from '@/app/(app)/export/actions';
import type { ExportGuide } from '@/lib/data-transfer/exports';
import { cn } from '@/lib/utils';

/*
 * Spreadsheet in, spreadsheet out, on the list itself.
 *
 * Export downloads exactly what the screen is showing — the same search and
 * filters, just without the page limit — after a short guide to what the
 * file holds and what each column means. Import brings master data in, and
 * the job cards, quotations and invoices a workshop carries over from its
 * old system — priced and numbered by the app's own rules, never trusted
 * from the file.
 *
 * On a phone both collapse into one menu, so they never compete with the
 * screen's primary action.
 */

export function ListDataActions({
  entity,
  /** The screen's current query string, so the file matches the screen. */
  search,
  /** Import is offered when the list allows it and the user may create rows. */
  canImport = false,
  /** Export is offered when the user holds the module's Export permission. */
  canExport = false,
  label,
  columns = [],
  note,
}: {
  entity: string;
  search?: string;
  canImport?: boolean;
  canExport?: boolean;
  /** What the rows are called, e.g. "customers". */
  label: string;
  columns?: ImportColumn[];
  /** How the file is laid out, when it isn't one row per record. */
  note?: string;
}) {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Closing the dialog bumps this, which remounts it — so the next import
  // starts on a fresh form rather than the last one's report.
  const [session, setSession] = useState(0);
  const query = search && search.length > 0 ? `?${search}` : '';
  const exportHref = `/export/${entity}${query}`;

  function setImportOpen(open: boolean) {
    setImporting(open);
    if (!open) setSession((current) => current + 1);
  }

  if (!canImport && !canExport) return null;

  return (
    <>
      {/* Phone: one quiet menu beside the primary action. */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-12"
                aria-label="Import or export"
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {/* A real link: the browser downloads the file rather than routing to it. */}
            {canExport ? (
              <DropdownMenuItem className="gap-2.5 py-2.5" onClick={() => setExporting(true)}>
                <Download className="size-4" />
                Export {label}
              </DropdownMenuItem>
            ) : null}
            {canImport ? (
              <DropdownMenuItem className="gap-2.5 py-2.5" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                Import {label}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tablet and up: the buttons themselves. */}
      <div className="hidden gap-2 sm:flex">
        {canImport ? (
          <Button variant="outline" className="h-10" onClick={() => setImportOpen(true)}>
            <Upload />
            Import
          </Button>
        ) : null}
        {canExport ? (
          <Button variant="outline" className="h-10" onClick={() => setExporting(true)}>
            <Download />
            Export
          </Button>
        ) : null}
      </div>

      {canExport && exporting ? (
        <ExportDialog
          entity={entity}
          href={exportHref}
          filtered={query !== ''}
          onClose={() => setExporting(false)}
        />
      ) : null}

      {canImport ? (
        <ImportDialog
          key={session}
          entity={entity}
          label={label}
          columns={columns}
          note={note}
          open={importing}
          onOpenChange={setImportOpen}
        />
      ) : null}
    </>
  );
}

function ImportDialog({
  entity,
  label,
  columns,
  note,
  open,
  onOpenChange,
}: {
  entity: string;
  label: string;
  columns: ImportColumn[];
  note?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult<ImportOutcome>>(
    async (previous, formData) => {
      const result = await importCsvAction(entity, previous, formData);
      if (result.ok && result.data && result.data.created > 0) {
        toast.success(`${result.data.created} ${label} imported`);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const outcome = state.ok ? state.data : undefined;

  function close(next: boolean) {
    if (isPending) return;
    onOpenChange(next);
    if (!next) {
      formRef.current?.reset();
      setFileName(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {label}</DialogTitle>
          <DialogDescription>
            {note ?? `A CSV file, one row per ${label.replace(/s$/, '')}.`} Rows already on file are
            skipped, and if any row can&apos;t be read nothing is imported.
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <ImportReport outcome={outcome} label={label} onDone={() => close(false)} />
        ) : (
          <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
            <a
              href={`/import/${entity}/template`}
              className="inline-flex items-center gap-2 self-start text-sm font-medium text-primary hover:underline"
            >
              <FileSpreadsheet className="size-4" />
              Download the template
            </a>

            {columns.length > 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Columns
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {columns.map((column) => (
                    <li
                      key={column.header}
                      className={column.required ? 'font-semibold' : 'text-muted-foreground'}
                    >
                      {column.header}
                      {column.required ? ' *' : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  * required. Extra columns are ignored, and the order doesn&apos;t matter.
                </p>
              </div>
            ) : null}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">CSV file</span>
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
                className="block w-full text-sm file:mr-3 file:h-11 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-4 file:text-sm file:font-medium hover:file:bg-muted"
              />
              {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
            </label>

            {state.error ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                {state.error}
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="submit" className="h-12 sm:h-11" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                {isPending ? 'Importing…' : 'Import'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12 sm:h-11"
                disabled={isPending}
                onClick={() => close(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportReport({
  outcome,
  label,
  onDone,
}: {
  outcome: ImportOutcome;
  label: string;
  onDone: () => void;
}) {
  const failed = outcome.errors.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          failed ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5',
        )}
      >
        <p className={cn('font-semibold', failed ? 'text-destructive' : 'text-success')}>
          {failed ? 'Nothing was imported' : `${outcome.created} ${label} imported`}
        </p>
        <p className="mt-1 text-muted-foreground">
          {failed
            ? `${outcome.errors.length} of ${outcome.total} rows could not be read. Fix them and import the file again — nothing was saved.`
            : outcome.skipped.length > 0
              ? `${outcome.skipped.length} row${outcome.skipped.length === 1 ? ' was' : 's were'} already on file and left alone.`
              : `All ${outcome.total} rows were new.`}
        </p>
      </div>

      {outcome.errors.length > 0 ? (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto text-sm">
          {outcome.errors.slice(0, 40).map((error) => (
            <li key={error.row} className="flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                Row {error.row}
              </span>
              <span>{error.message}</span>
            </li>
          ))}
          {outcome.errors.length > 40 ? (
            <li className="text-muted-foreground">…and {outcome.errors.length - 40} more.</li>
          ) : null}
        </ul>
      ) : null}

      {!failed && outcome.skipped.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto text-sm text-muted-foreground">
          {outcome.skipped.slice(0, 20).map((skip) => (
            <li key={skip.row} className="flex gap-2">
              <span className="w-14 shrink-0 tabular-nums">Row {skip.row}</span>
              <span>{skip.reason}</span>
            </li>
          ))}
          {outcome.skipped.length > 20 ? <li>…and {outcome.skipped.length - 20} more.</li> : null}
        </ul>
      ) : null}

      <Button className="h-12 sm:h-11" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/**
 * Before the file downloads: what it holds — one row per what, with the
 * screen's search and filters — and every column with what it means.
 */
function ExportDialog({
  entity,
  href,
  filtered,
  onClose,
}: {
  entity: string;
  href: string;
  /** A search or filter is on, so only those rows are in the file. */
  filtered: boolean;
  onClose: () => void;
}) {
  const [guide, setGuide] = useState<ExportGuide | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    exportGuideAction(entity).then((result) => {
      if (live) setGuide(result);
    });
    return () => {
      live = false;
    };
  }, [entity]);

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export {guide?.label.toLowerCase() ?? ''}</DialogTitle>
          <DialogDescription>
            A CSV file that opens in Excel or Google Sheets.{' '}
            {filtered
              ? 'Only the rows matching your current search and filters are included.'
              : 'Every row on the list is included — search or filter the list first to export only some.'}
          </DialogDescription>
        </DialogHeader>

        {guide === undefined ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading what the file holds…
          </p>
        ) : guide === null ? (
          <p className="py-6 text-sm text-muted-foreground">This list can’t be exported.</p>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <p className="text-sm">{guide.description}</p>
            <div className="min-h-0 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  <tr>
                    <th className="w-2/5 px-3 py-2">Column</th>
                    <th className="px-3 py-2">What it means</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {guide.columns.map((column) => (
                    <tr key={column.header} className="align-top">
                      <td className="px-3 py-2 font-medium">{column.header}</td>
                      <td className="px-3 py-2 text-muted-foreground">{column.hint ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          {/* A real link: the browser downloads the file rather than routing to it. */}
          <Button
            size="lg"
            nativeButton={false}
            render={<a href={href} onClick={() => setTimeout(onClose, 300)} />}
          >
            <FileSpreadsheet />
            Download CSV
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
