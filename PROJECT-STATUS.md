# Project Status

Last updated: 2026-09-16

## Stage: Phase 1 — Architecture consolidation + first vertical slice

This session executed a product-owner-directed architecture reversal
([ADR-008](docs/11-decisions/ADR-008-single-nextjs-application.md)):
Comet Autos is a dedicated internal workshop application, not a SaaS
platform, so the two-app split from ADR-007 (Next.js + NestJS) was replaced
with a single Next.js application talking to PostgreSQL directly via
Prisma. On top of that pivot, this session also built the first complete,
real (not stubbed) vertical slice: login → dashboard → Quick Check-In →
Job Card.

## What exists

- **Single Next.js 16 application** (`apps/web`) — Server Components,
  Server Actions, Route Handlers, Prisma called directly (no separate API).
  `apps/api` (NestJS) and `packages/shared` have been deleted.
- **Database**: the frozen-foundation Prisma schema
  (`prisma/schema.prisma`), covering nearly the full V1 domain
  (Organization/Branch/User/Role/Permission, Customer/Vehicle, the
  workshop pipeline, Estimate/Approval, Inventory ledger,
  Invoice/Payment/Accounting, HR/Payroll, Document/AuditLog/Numbering),
  plus two additive Phase 1 additions: `Session` (staff auth) and
  `CustomerAccessToken` (future customer secure-access links).
- **Auth**: email/password login, `bcryptjs` hashing, DB-backed sessions
  (`httpOnly` cookie, hashed token), `requireUser()`/`requirePermission()`
  enforcement in every protected Server Action — see
  `docs/07-security/authorization.md`.
- **App shell**: sidebar (grouped per the full V1 module list), topbar,
  page header — `apps/web/src/components/shell/`.
- **Dashboard** (`/`): real queries — today's appointments, vehicles
  currently in, jobs by status, waiting-for-approval count, low-stock
  parts, customer outstanding. (Numbers are 0 for modules not built yet —
  no fake data.)
- **Quick Check-In** (`/check-in`): search existing customer/vehicle by
  name/phone/plate, or create new inline; creates the Job Card
  transactionally with a status-history row and audit log entries.
- **Job Cards** (`/job-cards`, `/job-cards/[id]`): list with pagination,
  detail page with header, status-change controls (server-enforced state
  machine — see below), status history, and clearly-labeled "not built
  yet" placeholders for Inspection/Diagnosis/Estimate/Work/QC/Invoice/
  Documents tabs.
- **Every other nav destination** (Appointments, Inspections, Estimates,
  Approvals, Customers, Vehicles, Inventory, Finance, HR, Reports,
  Settings) renders an explicit "not built yet" placeholder rather than a
  404 or fake data — see `apps/web/src/components/shell/coming-soon.tsx`.
- **Dev seed data** (`prisma/seed.ts`, run via `npm run db:seed`): Comet
  Autos org, Al Qusais branch, the full V1 permission catalog (section 25
  of the build instruction), an Owner role with every permission, an Owner
  user, and 3 sample customers/vehicles.
- **`docs/integrations.md`**: every external integration boundary from the
  build instruction, all currently un-configured (none are required yet
  except self-hosted session auth).

## Known issue: JobCardStatus granularity

The build instruction describes a finer-grained workshop pipeline (BOOKED →
ARRIVED → INSPECTION → DIAGNOSIS → ESTIMATE → WAITING_APPROVAL → APPROVED →
WAITING_PARTS → IN_REPAIR → QUALITY_CHECK → READY → DELIVERED → CLOSED)
than the frozen `JobCardStatus` enum actually has (`RECEIVED`,
`INSPECTING`, `DIAGNOSED`, `ESTIMATE_SENT`, `APPROVED`, `IN_PROGRESS`,
`ON_HOLD`, `COMPLETED`, `INVOICED`, `CLOSED`, `CANCELLED`). Per the
frozen-foundation rule, this phase did not add new enum values — see the
mapping and rationale in `apps/web/src/lib/workshop/job-status.ts`. If this
proves too coarse once Inspection/Diagnosis/QC are built (Phases 2 and 4),
splitting it out is an additive schema change to flag explicitly at that
point, not a silent workaround.

## Known environment issue: Turbopack blocked on this machine

`apps/web`'s `dev`/`build` scripts pass `--webpack`. Next.js 16 defaults to
Turbopack, but this machine's Windows Application Control policy blocks the
native `@next/swc-win32-x64-msvc` binary Turbopack needs. Webpack works
fine and produces the same output; revisit if the policy changes or if
deploying to a different machine where Turbopack's native binary isn't
blocked.

## Verified working (this session)

- `npm run prisma:validate` / `npm run prisma:generate` — pass.
- `npx prisma migrate dev` — applied cleanly (additive-only migration) against
  the local embedded PostgreSQL.
- `npm run db:seed` — pass.
- `npm run lint --workspace=apps/web` — pass, zero warnings.
- `npm run build --workspace=apps/web` — pass, every route compiles.
- Manual dev-server walkthrough — see the session notes; login, dashboard,
  Quick Check-In (both new and existing customer/vehicle paths), and job
  status transitions were exercised against the seeded local database.

## Roadmap (not built yet — tracked here, not attempted in one pass)

Each of these becomes its own future phase, built the same way Phase 1
was: fully working end-to-end, not stubbed.

- **Phase 2 — Inspection & Diagnosis**: inspection checklist items, photo
  attachments (needs object storage — see `docs/integrations.md`),
  diagnosis findings/recommendation, feeding into Estimates.
- **Phase 3 — Estimates & Customer Approval**: quotation builder (labour +
  parts + VAT), revisioning, the secure customer-facing approval flow
  (`/customer/quote/[token]`) using the `CustomerAccessToken` model already
  added, dev-mock OTP verification.
- **Phase 4 — Repair Execution & Quality Check**: Work/Labour/Parts tabs on
  the Job Card, inventory consumption (`PartUsage` → `InventoryTransaction`),
  QC pass/fail flow.
- **Phase 5 — Invoicing & Payments**: invoice generation from actuals,
  payment recording/reversal, customer invoice access
  (`/customer/invoice/[token]`), PDF/print output.
- **Phase 6 — Customers/Vehicles Directory**: dedicated browse/search/edit
  screens (creation already works via Quick Check-In).
- **Phase 7 — Inventory & Purchasing**: Parts/Suppliers/Purchases CRUD,
  stock receiving, adjustments, low-stock alerts beyond the dashboard tile.
- **Phase 8 — Finance & Accounting**: Expenses, Chart of Accounts, Journal
  Entries, VAT reporting, basic P&L.
- **Phase 9 — HR & Payroll**: Employees, Attendance, Leave, Salary,
  Payroll calculation/approval/payment.
- **Phase 10 — Reports**: workshop/sales/collections/outstanding/inventory/
  technician-performance/attendance reports.
- **Phase 11 — Settings & RBAC UI**: workshop info, user management,
  role/permission management UI (permissions already exist and are
  enforced — this phase adds the UI to manage them), document numbering
  config, audit history viewer.
- **Notifications**: `NotificationService` + Email/SMS/WhatsApp provider
  interfaces (section 39) — needed once Phase 3/5 add "send quotation"/
  "send invoice" actions. See `docs/integrations.md`.
- **Import/export**: CSV/Excel import-preview-validate-commit flow, exports
  — deferred until a module has enough data volume to need it.

## Manual configuration required

Nothing yet. Every integration boundary that needs real credentials
(email, SMS/OTP, WhatsApp, payments, object storage, e-invoicing) is
documented in `docs/integrations.md` with what's needed and when — none of
Phase 1's features depend on them.
