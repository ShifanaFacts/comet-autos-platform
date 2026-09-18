# Project Status

Last updated: 2026-09-18

## Milestone: Ready → invoice → payment → paid → delivered — DONE (uncommitted, for review)

READY → INVOICED → PAID → DELIVERED, working against the local database;
`npm run test:integration` runs 41 tests (adds `tests/billing-flow.test.ts`).

- Migrations (additive, one transaction each):
  `20260918113231_invoicing_payments_delivery` — `JobCard.deliveredAt /
  deliveredByUserId / deliveryNotes`, `Payment.notes`, partial unique index
  `one_live_invoice_per_job_card` (status not VOID/CANCELLED), CHECKs
  `payments_positive_amount`, `invoices_total_is_subtotal_plus_tax`,
  `job_cards_delivery_complete`;
  `20260918113455_normalize_live_invoice_index` — rewrites that index
  predicate with `<>` so Prisma sees no drift.
- Service: `src/lib/billing/invoice.ts` (`buildBilling`, `createInvoice`,
  `recordPayment`, `deliverVehicle`, `getJobInvoice`, `getBillingPreview`).
  UI: `src/app/(app)/job-cards/[id]/billing/` on the job card page
  (`#invoice`, `#payments`, `#delivery`).
- Billing rule: each part/labour record linked to an APPROVED estimate line
  is billed at the approved price and VAT, capped at the approved quantity.
  Unlinked (unapproved) work, excess quantity and price differences are
  excluded and listed as notes on the preview and in the `invoice.issued`
  audit entry. InvoiceItem links to the Labour / PartUsage it bills.
- Payment state: invoice ISSUED (= unpaid) → PARTIALLY_PAID → PAID; paid =
  completed payments; overpayment refused under a row lock. Job moves
  INVOICED → PAID only when the balance reaches zero; delivery requires PAID
  and a zero balance.
- QC rule tightened: QC can't PASS while any approved line is incomplete.

### Decisions awaiting approval (billing)

1. Bill at the approved price, capped at the approved quantity (differences
   reported, never silently billed).
2. No journal entries are posted (no chart of accounts yet).
3. No delivery on credit — balance must be zero.
4. Invoice is issued directly (no draft step); no customer-facing invoice
   link or PDF yet; no void / refund / payment-reversal flow yet.

## Milestone: Repair → quality check → ready — DONE (uncommitted, for review)

APPROVED → REPAIR → parts used / labour → QUALITY_CHECK → READY, working
against the local database; `npm run test:integration` now runs 28 tests
(`tests/workshop-flow.test.ts`, `tests/repair-flow.test.ts`).

- Migration `20260918102849_repair_parts_labour_quality_check` (additive,
  one transaction): `EstimateKind` (ORIGINAL / ADDITIONAL) + `Estimate.notes`;
  `Labour.estimateItemId` and `PartUsage.estimateItemId` (the approved line
  a record fulfils; NULL = additional, unapproved work); new `QualityCheck`
  history table; CHECK constraints (failed QC needs corrections, positive
  quantities/hours, job consumption is a stock-out).
- Stock: `src/lib/inventory/stock.ts` — stock is the signed sum of the
  InventoryTransaction ledger; issuing locks the Part row, refuses to go
  negative, and writes one JOB_CONSUMPTION row in the same transaction as
  the PartUsage.
- Services: `src/lib/workshop/repair.ts`, `quality-check.ts`; additional
  work in `estimates.ts` (`createAdditionalEstimate`). Job card page shows
  the repair sections from APPROVED onwards; additional work has its own
  page `/job-cards/[id]/additional/[estimateId]`.
- Dev seed adds 12 parts with opening stock (idempotent).

### Decisions awaiting approval (repair)

1. **Selling price of parts used** is the catalog price at the time of use
   (snapshotted on PartUsage), which may differ from the approved estimate
   price. Invoicing must decide which one is billed.
2. **Cost of parts used** is the part's default cost price, snapshotted.
   No FIFO / weighted-average costing exists yet.
3. **QC with work remaining** is blocked (superseded 2026-09-18: QC cannot pass while any approved line is incomplete). QC is
   blocked while an additional-work request is waiting for the customer, and
   when no parts or labour were recorded at all.
4. **Labour line "done"** = any labour recorded against it; parts lines are
   done when the fitted quantity reaches the approved quantity.
5. **Corrections**: a wrongly recorded part or labour entry can't be undone
   in the UI yet (no stock-return / reversal flow).

## Milestone: Core workshop workflow (customer → approval) — DONE

Working end to end against the local PostgreSQL database, verified in a
real browser and by `npm run test:integration` (14 service-level tests on
throwaway organizations):

customer → vehicle → appointment / walk-in → Quick Check-In → Job Card →
technician → inspection → diagnosis → estimate (labour, parts, VAT,
revisions) → secure customer quotation link → customer approve / reject →
workshop sees the result.

- Services: `src/lib/customers`, `src/lib/vehicles`, `src/lib/appointments`,
  `src/lib/workshop/{check-in,assignment,inspection,diagnosis,estimates,workspace,job-status}.ts`,
  `src/lib/customer-access/{tokens,quote}.ts`. Every write checks
  permissions, runs in one transaction, and writes AuditLog (and
  JobStatusHistory for status changes).
- Screens: Customers, Vehicles, Appointments, Quick Check-In, Job Card
  workspace (current status + next action), Inspection (tablet checklist),
  Diagnosis, Estimate, Inspections / Estimates / Approvals queues, and the
  public `/customer/quote/[token]` page.
- Dev seed adds four employees (inspections, diagnoses and assignments must
  reference an Employee).

### Schema corrections (2026-09-18)

Two additive migrations, no data deleted:
`20260918070227_workshop_status_and_approval_attribution` (enum values,
columns) and `20260918070338_job_status_and_approval_data` (backfill,
default, CHECK constraints — one explicit transaction).

- **Job status** now stores the real workflow: ARRIVED → INSPECTION →
  DIAGNOSIS → ESTIMATE → WAITING_APPROVAL → APPROVED / REJECTED → REPAIR →
  QUALITY_CHECK → READY → INVOICED → PAID → DELIVERED (+ ON_HOLD,
  CANCELLED). Legacy values (RECEIVED, INSPECTING, DIAGNOSED, ESTIMATE_SENT,
  IN_PROGRESS, COMPLETED, CLOSED) stay in the enum only because
  JobStatusHistory is append-only; live job cards were migrated off them and
  the app never writes them. Mapping: `src/lib/workshop/stages.ts`.
- **ApprovalMethod.ONLINE** for decisions made on the secure link.
  DIGITAL_SIGNATURE is reserved for real signature capture.
- **Attribution:** `Approval.customerId` (required, the decider),
  `Approval.decidedAt`, `Approval.recordedByUserId` now nullable (NULL for
  ONLINE; a CHECK enforces it). `JobStatusHistory.changedByCustomerId` added,
  `changedByUserId` nullable, CHECK: exactly one actor. The sender of the
  quotation remains `Estimate.sentByUserId`.
- **VAT:** default rate lives only in `src/lib/tax.ts`
  (`resolveDefaultVatRate`), passed into calculations and the estimate
  builder.

### Decisions awaiting approval

1. **Legacy history rows.** Status-history rows written before the migration
   keep their original status names and actors (append-only rule). Online
   approvals made before the migration therefore still show the link sender
   as the actor in the job's history; the Approval rows themselves were
   corrected to ONLINE / customer.
2. **Post-approval stages** (REPAIR → … → DELIVERED) are still advanced with
   manual buttons until their own screens exist.
3. **VAT** defaults to 5% per line (editable per line). No organization VAT
   setting exists yet; `resolveDefaultVatRate` is the single place to add it.
4. **Estimate revisions** are numbered `EST-000123-R2` (unique constraint
   requires a distinct number); the old version's link is revoked.
5. **Quotation validity** defaults to 14 days; the customer link expires at
   the end of that day. Verification cookie lasts 1 hour.
6. **Check-in rules:** a vehicle with an open job can't be checked in again;
   mileage can't be lower than the last recorded reading or above 2,000,000 km.
7. **Permissions:** no appointment/inspection/estimate codes exist in the
   catalog, so appointments use `job_card.create` and inspection, diagnosis
   and estimates use `job_card.edit`.
8. Whole-quotation approve/reject only — partial approval is not offered.

### Remaining gaps in this milestone

- Job card **notes** and inspection **severity** have no schema fields.
- **Photos/documents**: the Document model exists but no file storage is
  configured (see docs/integrations.md).
- Quotation links are **copied and sent by staff** — no email/SMS/WhatsApp
  provider is connected. No OTP, and no rate limit on the verification form
  (the 256-bit token is the real secret).
- No employee management screen (employees come from the seed).
- Changing a vehicle's owner is not supported.

## Stage: Phase 1 — Architecture, auth, design system, and the first real vertical slice

This session did two things: (1) a product-owner-directed architecture
reversal — Comet Autos is a dedicated internal workshop application, not a
SaaS platform, so the NestJS API split from ADR-007 was replaced with a
single Next.js application talking to PostgreSQL directly via Prisma
([ADR-008](docs/11-decisions/ADR-008-single-nextjs-application.md)) — and
(2) a full premium-UI pass establishing the Comet Autos design system
(Graphite + Electric Violet + Silver + White) and rebuilding the shell,
dashboard, Quick Check-In, and Job Card screens on top of it. Everything
below is real and working against the local database, not a mockup.

## DONE

### Architecture & foundation

- Single root-level Next.js 16 application; `apps/api` (NestJS), the empty
  `packages/shared`, and the now-pointless `apps/web` monorepo wrapper have
  all been deleted. Prisma called directly from Server Actions/Route
  Handlers — no separate API layer.
- Frozen-foundation Prisma schema kept as-is; two additive-only tables
  added: `Session` (staff auth) and `CustomerAccessToken` (future customer
  secure-access links).
- Self-hosted session auth: `bcryptjs` password hashing, DB-backed sessions
  (`httpOnly` cookie, only the SHA-256 hash stored), `requireUser()`/
  `requirePermission()` enforced in every protected Server Action — see
  `docs/07-security/authorization.md`.
- Checkpoint commit `064842e` captures the pre-redesign working state.

### Design system

- Official brand tokens in `src/app/globals.css`: `--primary`
  (Electric Violet `#7c3aed`), `--primary-hover` (Deep Violet `#5b21b6`),
  graphite sidebar (`#111118`), soft-white background (`#f8f8fa`), silver
  borders (`#cbd5e1`), plus dedicated semantic tokens `--success`/
  `--warning`/`--danger`/`--info` for status colors — kept independent of
  the brand accent per the brand direction ("don't use brand purple for
  every status").
- Reusable components: `PageHeader`, `EmptyState`, `QuickAction`,
  `WorkflowStepper`, `WorkshopFlowRow`, `StatusTimeline`, `JobStatusBadge`
  (semantic colors), `MoneyDisplay`, `ConfirmAction`, `GlobalSearch` — all
  under `src/components/shared/` and `shell/`.
- shadcn/base-ui primitives in use: Button, Input, Label, Table, Badge,
  Separator, Dialog, DropdownMenu, Skeleton.

### App shell

- Dark graphite sidebar, icon-labeled nav (Lucide), active-state accent,
  collapsible (persisted per-viewer via `localStorage`).
- Topbar: global search trigger + user menu (dropdown, avatar initials,
  sign out) + branch chip.
- Global search (Cmd+K / `/`): searches customers (name/phone), vehicles
  (plate/VIN), job cards (job number) in one dialog, grouped results,
  keyboard-triggered from anywhere in the app.
- Friendly `error.tsx` boundaries (root + app shell) and a route-level
  `loading.tsx` skeleton — no raw stack traces reach the UI, no bare
  spinners for page loads.

### Dashboard (`/`) — a workshop control center, not a card grid

- Greeting + date hero with primary quick actions (Check In Vehicle is the
  most prominent; New Estimate/Create Invoice shown as honestly disabled
  with a "Phase X" badge, since those modules don't exist yet).
- Attention Required section (quotations waiting, jobs on hold, low
  stock) — or a "You're all caught up" empty state when there's nothing.
- Today's Workshop flow row: live counts per workflow stage
  (Received → Inspection → Diagnosis → Estimate → Approved → In Repair →
  Completed → Invoiced), driven by real `JobCard` data.
- Finance snapshot (today's sales, today's collections, customer
  outstanding) and Inventory (low-stock list) — both real queries.
- Team section is an honest "coming in Phase 9" state, not fake
  present/absent counts (HR/Attendance isn't built — showing zeros there
  would misrepresent reality, not just be incomplete).

**Quick Check-In** (`/check-in`): search-first UX (name/phone/plate),
inline new-customer/vehicle creation, transactional Job Card creation
(sequential numbering via a row-locked `DocumentNumberSequence`, status
history, audit log), and a proper success confirmation state ("Job Card
Created — JC-000123" with Open Job Card / Check in another vehicle) instead
of an abrupt redirect.

**Job Cards** (`/job-cards`, `/job-cards/[id]`): searchable, status-filterable,
paginated list; detail page with a horizontal `WorkflowStepper`, a
prominent "Next action" panel (primary forward transition as the main
button, Hold/Cancel as secondary — Cancel is confirm-gated), a vertical
`StatusTimeline`, and clearly-labeled "coming in Phase N" panels (with
icons) for Inspection/Diagnosis/Estimate/Work/QC/Invoice/Documents.

**Every other nav destination** renders an explicit, styled "not built
yet" empty state rather than a 404 or fake data.

**Dev seed data** (`prisma/seed.ts`): Comet Autos org, Al Qusais branch,
the full V1 permission catalog, an Owner role/user
(`shifanachennara@gmail.com`), 3 sample customers/vehicles.

## IN PROGRESS

Nothing mid-flight — Phase 1 (architecture + auth + design system +
dashboard + Quick Check-In + Job Card) is complete and verified end-to-end.

## NEXT

Each becomes its own future phase, built fully working end-to-end (not
stubbed), in roughly this order:

- **Phase 2 — Inspection & Diagnosis**: checklist items, photo attachments
  (needs object storage, see `docs/integrations.md`), findings/recommendation.
- **Phase 3 — Estimates & Customer Approval**: quotation builder, revisioning,
  the secure customer-facing approval page (`/customer/quote/[token]`,
  mobile-first, using the `CustomerAccessToken` model already added), mock
  OTP verification.
- **Phase 4 — Repair Execution & Quality Check**: Work/Parts/Labour on the
  Job Card, inventory consumption, QC pass/fail.
- **Phase 5 — Invoicing & Payments**: invoice generation, payment
  recording/reversal, customer invoice page, PDF/print.
- **Phase 6 — Customers/Vehicles Directory**: dedicated browse/search/edit
  screens (creation already works via Quick Check-In).
- **Phase 7 — Inventory & Purchasing**, **Phase 8 — Finance & Accounting**,
  **Phase 9 — HR & Payroll**, **Phase 10 — Reports**, **Phase 11 — Settings
  & RBAC UI** (role/permission management UI — enforcement already exists).
- **Notifications** (Email/SMS/WhatsApp) and **import/export** — deferred
  until the modules that need them exist.

## BLOCKED

Nothing is blocked. All Phase 1 work was completable without external
credentials — see docs/integrations.md for what future phases will need
from you.

## MANUAL CONFIGURATION REQUIRED

Nothing yet. Every external integration boundary (email, SMS/OTP,
WhatsApp, payments, object storage, e-invoicing) is documented in
`docs/integrations.md` with exactly what's needed and when — none of
Phase 1's features depend on them; self-hosted session auth needs no
external provider.

## KNOWN LIMITATIONS

- **`JobCardStatus` granularity**: the build instruction's conceptual
  pipeline (BOOKED → ARRIVED → INSPECTION → DIAGNOSIS → ESTIMATE →
  WAITING_APPROVAL → APPROVED → WAITING_PARTS → IN_REPAIR → QUALITY_CHECK →
  READY → DELIVERED → CLOSED) is finer than the frozen `JobCardStatus` enum
  (11 values). Per the "don't redesign the schema without a genuine
  blocker" rule, this phase maps the conceptual pipeline onto the existing
  enum rather than adding new values — see the mapping and rationale in
  `src/lib/workshop/stages.ts` and `job-status.ts`. Flag for
  revisiting (as an additive schema change) if Phases 2/4 find it too
  coarse in practice.
- **Turbopack is disabled on this dev machine**: the app's `dev`/`build`
  scripts pass `--webpack`. This machine's Windows Application Control
  policy blocks the native `@next/swc-win32-x64-msvc` binary Turbopack
  needs; webpack produces identical output. Revisit if the policy changes
  or on a different machine.
- Dashboard's "Today's sales"/"Collections"/"Customer outstanding" figures
  are real queries but will show AED 0.00 until Phase 5 (Invoicing) exists
  — there's simply no invoice/payment data yet, not a bug.

## Verified this session

- `npm run prisma:validate` / `npm run prisma:generate` — pass.
- `npx prisma migrate dev` — applied cleanly (additive-only) against local
  embedded PostgreSQL.
- `npm run db:seed` — pass.
- `npm run lint` — pass, zero warnings/errors.
- `npm run build` — pass, every route compiles.
- Manual dev-server walkthrough over HTTP with a real authenticated
  session: login redirect, dashboard (all sections render with live seeded
  data), Quick Check-In transaction logic (job numbering increments
  correctly across runs, status history + audit rows created), job status
  state machine (valid transition applied, invalid transition rejected
  with no partial state change), job-cards list/filter, and the violet
  brand token confirmed present in the compiled CSS.
