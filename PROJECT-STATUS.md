# Project Status

Last updated: 2026-09-17

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
