# Project Status

Last updated: 2026-09-21

## Phase 14: Supplier payments & payables (uncommitted)

187 integration tests pass (adds `tests/supplier-payments.test.ts`, 19 tests).
**No schema change.** `SupplierPayment` already carried everything: amount,
method, reference, `paidAt`, `paidByUserId`, a COMPLETED/REVERSED status and
`reversalOfSupplierPaymentId`. `DocumentType.SUPPLIER_PAYMENT` and its `SP-`
prefix were already in the numbering table. What was missing was a way in
from the application, and that is all this milestone adds.

**One rule, not a fourth copy.** The supplier balance arithmetic existed in
three places that agreed only because they had been copied carefully — the
outstanding screen, the supplier directory, and (nearly) the payables work.
`lib/finance/supplier-balance.ts` is now the only definition, and all three
call it, as does recording a payment:

    owed = value of stock actually received − the payments that count

A reversal drops **both** rows — the original is no longer money paid, and
the reversal is not a second payment. Measured from the purchase, never from
stock on hand: parts already fitted to a car are still owed for.

Screens under `/finance/payables`:

- **Overview** — total outstanding, suppliers owed, over-30-days, ageing;
  bills oldest first (cards to `lg`, table above); suppliers grouped by what
  they are owed; recent payments. Search, supplier and age filters in the URL.
- **Supplier account** — the balance in one number, the bills making it up
  with a Pay button on each, full purchase history and full payment history.
- **Record a payment** — two steps on purpose. The amount is typed against a
  live "remaining after this payment" figure with a one-tap *Pay in full*;
  the confirmation then restates supplier, purchase, current outstanding,
  amount, remaining and method before anything is written.

What is refused, all server-side: zero/negative/malformed amounts, more than
is owed (to the fil), a future date, a date before the goods were received,
a purchase not yet received, another organization's purchase, another
branch's purchase. The purchase row is locked `FOR UPDATE` for the length of
the transaction, so two payments racing cannot both pass the overpayment
check — tested with a genuine concurrent pair.

Permissions reuse the expense pattern exactly: `inventory.view` to read
(unchanged from supplier outstanding today), `accounting.create` to record,
`accounting.edit` to reverse.

**Nothing is ever deleted.** A payment made in error is reversed: the
original stays, marked REVERSED, a linked reversal row is written, both drop
out of the balance, and the audit log carries the reason.

## Phase 13: Users, roles & access management (uncommitted)

168 integration tests pass (adds `tests/access-management.test.ts`, 20 tests).
**No schema change** — `User.isActive`/`lastLoginAt`, `Role.isSystem`,
`UserRole`'s soft-revoke with `assignedByUserId`/`revokedByUserId`, and
`Employee`'s `@@unique([organizationId, userId])` were all already there.

**One data change, not a schema change.** The V1 permission catalogue had 31
codes across nine modules and none of them covered access management — so
until now, changing who could sign in meant SQL. Three codes were added to
the existing global `Permission` table through the same mechanism the seed
uses (`upsert` by `code`): `user.view`, `user.manage`, `role.manage`.
`npm run db:permissions` (`prisma/ensure-permissions.ts`) is idempotent, adds
only missing rows, and grants the three to **roles that already held every
other permission** — so nobody's real reach changed; the people who could
already do this directly in the database now have a screen for it.
`src/lib/auth/permission-catalog.ts` is the single source the seed, that
script and the role screens all read.

Screens, all under `/settings`:

- `/settings/users` — search, active/inactive/all, role and branch filters,
  paginated at 25. Cards on phone and tablet, a dense table from `lg`.
- `/settings/users/new` and `/[id]/edit` — one form; creating also sets the
  first password and can link an employee.
- `/settings/users/[id]` — account, roles with who granted them, the
  permissions those roles add up to, recent activity, and the sensitive
  actions (deactivate, reset password).
- `/settings/roles` and `/settings/roles/[id]` — every role, and what it
  allows laid out by module with a plain-English line per permission.

Four rules are enforced in the services and nowhere else:

1. **One login per employee.** The database already refused a second; the
   service explains it, and the picker only offers employees without one.
2. **Nobody removes their own access.** Deactivating yourself or changing
   your own roles is refused.
3. **The workshop never loses its last administrator.** Deactivating a user,
   changing their roles, or removing `user.manage` from a role is refused if
   it would leave no active user able to manage access.
4. **Built-in roles are read-only.** `isSystem` roles can't be renamed or
   have their permissions changed.

Role grants are revoked, never deleted, so who held what and who granted it
stays readable. Deactivation and a password reset both end live sessions —
`lib/auth/session` already refuses a session whose user is inactive, and a
reset revokes every session row.

## Phase 12: Photographing the work where the work happens (uncommitted)

148 integration tests pass (`tests/media-flow.test.ts` grows from 8 photo
tests to 11). **No schema change** — `Document` already carried `jobCardId`,
`stage` (all seven `MediaStage` values), `description`, `deletedAt`,
`deletedByUserId` and the `(organizationId, jobCardId, stage)` index.

The storage, upload, validation, soft-delete and secure-serving layer was
already built and is untouched. What was missing was the camera being
anywhere a technician actually works: every photo had to be added from the
job card, through a gallery picker, choosing its stage from a dropdown.

`components/media/stage-photos.tsx` + `stage-photos-panel.tsx` put a capture
strip on the screen for each stage — inspection, diagnosis, repair, quality
check and delivery. The stage is fixed by the screen, so there is nothing to
choose and nothing to type: **Take photo** (a `capture="environment"` input,
so the phone opens the camera directly) or **Gallery**, then the photo
uploads on its own. A local preview appears the instant the shutter closes
and is replaced by the stored one when the server catches up; a failure
leaves the photo in place with its reason and a **Retry** that re-sends under
the same request key, so a retry after a timeout that actually landed never
adds a second copy.

Two rules kept consistent rather than reinvented:

- **When photographing is allowed** is the job's own rule — live until
  DELIVERED or CANCELLED — decided once in `StagePhotosPanel`, not per
  screen. The stage screen only says which stage a photo files under.
- **A photo belongs to its job.** `removeJobPhoto` now takes the job the
  request came from, so a document id lifted from one job card cannot be
  acted on from another, even by someone who may edit both.

`/media/[id]` now answers `If-None-Match` with a 304 — after the permission
check, never before, so a tag can't confirm a file exists to someone who may
not see it.

`lib/media/client.ts` and `components/media/photo-viewer.tsx` are the upload
path and lightbox extracted from `job-photos.tsx`, so the job card gallery
and the stage strips behave identically. The gallery keeps its captions,
multi-select, stage filter chips and stage dropdown; it gained the same
direct-to-camera button.

## Phase 11: Workshop settings (uncommitted)

145 integration tests pass (adds `tests/organization-settings.test.ts`, 12
tests). **No schema change** — the columns were added in the Phase 9 migration
and read everywhere already; what was missing was a way to change them without
SQL. `/settings` is no longer a `ComingSoon` placeholder.

`lib/organization/settings.ts` owns the two things that leave the screen:

- **The seller block** — name, legal name, address, phone, email and TRN, read
  by `lib/documents/build.ts` for every quotation, invoice and receipt.
- **VAT** — `isVatRegistered` and `vatRate`, read by `lib/tax.ts` for the rate
  new estimate, invoice, purchase and expense lines start at.

The rule the tests pin down: **changing the rate changes what is offered next,
never what has already been issued.** Every estimate, invoice and purchase line
stores the rate it was priced at, so a quotation sent at 5% still totals 105
after the workshop moves to 7.5% or de-registers. Turning VAT off makes new
lines default to 0% but keeps the configured rate, so re-registering does not
mean retyping it.

The base currency is shown and deliberately not editable: every amount on
record is in it, and re-labelling them would misstate what was charged.

Input is normalised on the way in — the name's runs of whitespace collapse,
the email lower-cases, the TRN is stored as digits so `1002 0030 0400 003` and
`100200300400003` are the same number. A rate outside 0–100 is refused.

Permissions: `accounting.view` to read, `accounting.edit` to save, both
enforced in the service. Someone with view but not edit gets a read-only
`<dl>`, not a disabled form. The change is audited
(`organization.settings_updated`, before and after) and carries a request key,
so a double-submitted form saves once.

## Phase 10: Finance dashboard (uncommitted)

133 integration tests pass (adds `tests/finance-dashboard.test.ts`, 15 tests).
**No schema change** — every figure comes from columns that already exist.

`/finance` (nav: Finance → Overview), built on `lib/finance/dashboard.ts`.

Calculation rules, defined once at the top of that file:

- **Revenue** — invoices ISSUED in the period, at their own stored amounts.
  DRAFT is not revenue; VOID and CANCELLED never count.
- **Collected** — payments received in the period that count: completed, not
  a reversal, and not since reversed.
- **Expenses** — RECORDED expenses dated in the period; voided never count.
- **VAT** — output from those invoices, input from those expenses, read from
  the organization's settings. A workshop that is not VAT-registered reports
  zero and the panel says so plainly.
- **Owed** — the live figures from `lib/finance/outstanding`, never a second
  version of that calculation.
- **Position** — revenue less expenses, both excluding VAT, labelled as an
  operating margin rather than an accounting profit.

Periods are the workshop's own days in Dubai: Today / This week (from Monday)
/ This month / a custom range, stated in the page description so there is no
doubt what a number covers. `issueDate` and `expenseDate` are DATE columns and
compare as dates; payments carry an instant, so their window runs Dubai
midnight to Dubai midnight.

Permissions are per section, enforced server-side: `invoice.view` for sales
and receivables, `accounting.view` for expenses and VAT, `inventory.view` for
payables. A user with none of them is refused outright; a user with some sees
only those sections, and the withheld queries are never run.

Measured: **21 queries, 11–21 ms** for a full render, constant across periods
and row counts (no N+1).

## Milestone: Ownership, VAT configuration & outstanding balances (uncommitted)

118 integration tests pass (adds `tests/ownership-finance.test.ts`, 13 tests).
One additive migration, `20260921090000_employee_contact_org_vat_job_customer`.

**A — Employee contact.** `Employee.phone` and `Employee.email`, both nullable
and independent of the optional system login, so a technician who never signs
in can still be reached. Searchable; shown on the profile as tap-to-call.

**B — Vehicle ownership.** `JobCard.customerId` (NOT NULL, FK, indexed),
backfilled from each vehicle's owner. A job now keeps the customer it was
opened for, for ever. Every job-scoped read moved from `vehicle.customer` to
`jobCard.customer` — invoices, approvals, quotation and invoice PDFs, customer
links, WhatsApp recipients, search, dashboards, job lists and queues. Two
writes mattered most: the invoice's customer and the approval's customer were
both read from the vehicle at the moment of writing.

A real bug was found and fixed along the way: a customer's job history was
found *through their current vehicles*, so after a sale the previous owner's
history would have vanished and the buyer would have inherited it.

`transferVehicleOwnership` completes the picture — `vehicle.edit`, reason
required, registration typed back to confirm, row locked, request-key
protected, and audited with both owners plus how many open jobs stayed with
the seller. Past jobs on a vehicle are marked with the previous owner's name.

**C — Organization VAT.** `Organization.isVatRegistered` (default true) and
`vatRate` (default 5.00, CHECK 0–100); `taxNumber` unchanged. `lib/tax.ts` now
reads them — `resolveDefaultVatRate()` became async and every one of its 16
call sites awaits it, passing the transaction client where there is one. An
organization that is not VAT-registered defaults new lines to 0%. The last
hard-coded rate (`'5.00'` in `inventory/parts.ts`) is gone. Issued documents
keep the rate they were priced at.

**Phase 9 — Outstanding.** `/finance/outstanding` with two views. Customers
owe = issued invoices less payments that count; suppliers = value of stock
actually *received* on a purchase less supplier payments that count — measured
from purchases, never from stock on hand. VOID/CANCELLED invoices, CANCELLED
and REVERSED purchases, and reversed payments never count. Both reuse the same
balance helpers the invoice and purchase screens use, so a figure here can
never disagree with its document. Ageing buckets, search, age filters, and
branch scoping for branch-tied users.

## Milestone: Operational records — employees & expenses (uncommitted)

105 integration tests pass (adds `tests/operations-flow.test.ts`, 17 tests).
**No schema change** — both models already existed and were unused.

- **Employees** (`lib/hr/employees.ts`, `/hr/employees`): list with working /
  left / all filters and search, profile showing the jobs they carry and the
  labour attributed to them, create and edit. An employee is never deleted —
  someone who leaves is marked inactive with a leaving date, so every job
  they worked on still reads correctly. An optional system login may be
  linked, and one login stands for exactly one employee. Gated on
  `payroll.view` / `payroll.create`.
- **Expenses** (`lib/finance/expenses.ts`, `/finance/expenses`): record what
  the workshop spends to keep running, with the VAT split done by the same
  exact-money helper invoices use (integer fils, never floating point).
  Totals cover exactly the filtered set. A mistake is voided, not deleted —
  the row stays, stops counting, and the reason goes to the audit log.
  Categories are the organization's EXPENSE chart-of-accounts rows; the seed
  now adds ten standard ones idempotently. Gated on `accounting.view` /
  `accounting.create` / `accounting.edit`.
- **Signatures** now state their absence: the job card always shows the
  Signatures section, reading "No signature provided" when there is none,
  rather than hiding the section.
- `InlineForm` was rebuilt as a button plus a conditional panel. It had used
  `<details open={…}>`, which React treats as controlled and therefore
  fights the browser's own toggling.

Both screens were browser-walked at 1440 and 390 with no sideways scroll and
no console errors, including a real expense recorded (5000.00 net → 250.00
VAT) and then voided.

## Milestone: Job photos, signatures & responsive workshop UI — IN PROGRESS (increment 2 done, committed in aac7f76)

88 integration tests pass (adds `tests/media-flow.test.ts`, 11 tests).

Schema (both migrations applied, no drift; additive only):

- `20260919120000_media_signature_types` — `MediaStage`, `SignatureContext`,
  `SignerType`; `DocumentCategory.SIGNATURE`.
- `20260919120100_job_media_and_signatures` — Document gains `jobCardId`,
  `stage`, `description`, `deletedByUserId`; new `signatures` table; CHECK
  constraints for attribution and one handover signature per job.

Photos:

- Storage abstraction (`lib/storage`): `FileStorage` interface with a local
  disk driver chosen by `STORAGE_DRIVER`; no business code names a provider.
- `lib/media/photos.ts`: upload (checked by actual bytes — JPEG/PNG/WebP
  only, 10 MB each, 12 per upload), list, soft-remove with attribution, and
  read. Files are served only by document id through `/media/[id]`, which
  checks the viewer's organization and branch; storage keys never reach a
  screen or a URL.
- On the job card: stage chips, thumbnail grid, a viewer, and an upload
  dialog that downscales large photos on the device before sending. The
  phone quick-action bar opens the camera/gallery picker directly.

Signatures (always optional — the workflow completes without one):

- Captured on the quotation approval (customer link and in-person) and on
  the delivery handover; recorded as a business record (who signed, what
  they signed, when, which device captured it) with an audit entry, and
  shown on the job card.

Responsive (phone / tablet / desktop, verified at 375–1920):

- Bottom navigation on phones (Home / Jobs / Check-in / More); the drawer
  now opens from "More" only — the duplicate hamburger is gone.
- Job card rebuilt mobile-first: vehicle hero with plate, status, one-tap
  call, journey progress (full stepper from `xl`, compact bar below), and a
  fixed quick-action bar with the actions that fit the job's stage.
- No horizontally scrolling tables: approved work, parts, labour, invoice
  lines and quotation lines each render as cards on phones and as a table
  from `md` up. Job-cards list likewise. The estimate builder stacks each
  line's fields instead of a sideways grid.
- Fixed: `Grid` had no default `grid-cols-1`, so its implicit column was
  sized to its widest content and pushed wide tables off tablet screens;
  the workflow stepper's `whitespace-nowrap` labels overflowed at 1280; the
  document action row could not wrap; several links were under 36px tall on
  a phone. Job-card list paging dropped the status/search filters.

Visual system (increment 3):

- Elevation is now a token (`--shadow-card` / `--shadow-raised` /
  `--shadow-float`) with a theme-aware tint, so cards sit on the page
  instead of being outlined on it. Radius 8px → 12px, softer hairline
  border, deeper page ground, higher-contrast muted text.
- A typographic scale that actually steps: page title 28/36px, section
  title 17px, body 13–14px. Money and counts are tabular and weighted.
- Ordered sections carry a numbered marker (`Section step={n}`) so the
  repair workspace reads as a sequence.
- Motion where there was none: nav items, action tiles, pipeline stages and
  table rows respond to hover and focus, all behind
  `motion-reduce:transition-none`. The sidebar's current page is a violet
  pill rather than a hairline, and the dashboard's anchor strip carries a
  violet wash.
- The job card showed four empty forms at once. Each now folds behind its
  own labelled action (`InlineForm`, a native `<details>`, so it works
  without JavaScript); the one the job is waiting on opens by default. No
  field or action was removed — the screen is 20% shorter and reads as a
  record of work.
- The parts and labour tables gave their description column 80px out of
  725. The part/labour name and the approved line it fulfils now share one
  cell, the numeric columns are fixed and no longer wrap, and rows have
  room.

Visual system (increment 4 — the component layer, where "basic" actually
lived):

- Buttons were flat colour fills. The primary action is now lit from above
  (an inset highlight over a gradient) and casts a violet-tinted shadow
  (`--shadow-primary`), so it reads as a control rather than a coloured
  rectangle. Outline and secondary get `--shadow-control`.
- Inputs were flat outlined boxes; they now carry `--shadow-inset-field`, so
  a field reads as a recess.
- Scrollbars were the platform default — a wide grey rail that dated every
  screen. App-wide they are a thin floating thumb on a transparent track;
  the sidebar hides its bar entirely (`.scrollbar-none`) and still scrolls
  by wheel and touch.
- The sidebar was a flat slab. It now carries a violet bloom behind the
  brand, a gradient brand tile with a halo (`--shadow-glow`), and a gradient
  active pill with an inset ring instead of a 3px hairline.
- The top bar is properly glassy (`backdrop-blur-xl` over `background/60`)
  and the signed-in avatar carries the same violet halo as the brand mark.
- The page ground is a fixed violet radial wash rather than one flat grey.

Still visually weak, in priority order: the white content cards are still
plain rectangles; the "Money today" tiles are bare number blocks; empty
action tiles still show a large grey "0"; the finance and inventory list
pages have not had the same pass as the job card.

Not done — needs a decision, not code: a technician-specific home ("My
jobs"). The organization has one role, Owner; there is no Technician role
to key a role-aware home off, and inventing one would be a business
decision. Employees exist as records without user accounts.

## Workshop-floor UX, reliability & account — increment 1 (uncommitted)

Done in increment 1 (77 integration tests; adds `tests/reliability.test.ts`,
`tests/account.test.ts`):

- Duplicate-safe submissions: `request_keys` table (migration
  `20260919090000_request_keys`, additive) + `lib/request-keys.ts`;
  `useFormAction` sends a one-time key and ignores re-submits while pending.
  Payments, part usage, labour, part returns, QC records, appointments,
  check-in, customers, vehicles, stock adjustments, parts, suppliers,
  purchases and receipts are recorded once; a repeat answers with the first
  result.
- Plain failure messages (`systemFailureMessage`), page error / not-found /
  access-denied screens with retry.
- Account: name + role in the header, account menu (profile, change
  password, log out — the menu previously crashed on open), `/account`,
  password change signs out other sessions, back-button protection after
  logout, login by email or mobile with return to the requested page.
- Navigation filtered by permission; unbuilt modules kept, marked "Soon".
- Dashboard: Dubai "today", exact finance totals via billing rules (no full
  payments scan), branch-consistent low stock, action board, today's
  appointments. One status palette (`lib/workshop/status-tone.ts`).
- Invoices and Payments list pages (were placeholders). Job card loads its
  sections in parallel.

Next: screen-by-screen redesign of the workflow screens, then the full
18-step browser journey. Job-card photos and signatures await schema approval.

## Milestone: Customer documents + WhatsApp sharing — DONE (uncommitted, for review)

Quotation, tax invoice and payment receipt as PDFs; WhatsApp sharing by
deep link; mobile customer pages for quotations and invoices; a "Customer
communication" block on the job card. `npm run test:integration` runs 66
tests (adds `tests/documents-flow.test.ts`). No schema change.

- Layers: `lib/documents/build.ts` (domain → document model, using stored
  totals and `invoiceBalance` / `receiptBalances` from billing),
  `lib/documents/pdf/{writer,render}.ts` (dependency-free PDF writer +
  layout, formatting only), `lib/sharing/whatsapp.ts` (phone normalisation,
  messages, wa.me URL), `lib/customer-access/{access,share,verify-browser}.ts`
  (registration + mobile verification for quote and invoice links; share
  links), customer pages `/customer/quote/[token]`, `/customer/invoice/[token]`.
- PDF routes: staff `/documents/{quotation,invoice,receipt}/[id]`
  (session + permission); customer `/customer/quote/[token]/pdf`,
  `/customer/invoice/[token]/pdf`, `/customer/invoice/[token]/receipts/[RCT-…]/pdf`
  (only after the browser verified that link). `?download=1` downloads.
- Sharing issues a fresh secure link each time (raw tokens are never stored)
  without revoking earlier ones; audited as `customer_access.link_shared`.
  Quotation links expire with the quotation (30 days once decided); invoice
  links after 90 days. Receipts are shared through the invoice link.

### Decisions awaiting approval (documents)

1. PDFs use the built-in Helvetica font (no dependency, no font files):
   Latin text only — Arabic names print as "?". Supporting Arabic needs an
   embedded font and text shaping (a separate decision).
2. No payment instructions / bank details on invoices (not in the schema).
3. Each WhatsApp share creates an extra valid link rather than reusing one.
4. Quotation numbers stay `EST-…` (existing numbering), shown as "Quotation".

## Milestone: Inventory management — DONE (uncommitted, for review)

Parts catalogue, suppliers, purchase receiving, the stock ledger, stock
controls and job-part returns, against the local database;
`npm run test:integration` runs 58 tests (adds `tests/inventory-flow.test.ts`).

- Migrations (additive): `20260918140000_inventory_ledger_types` (enum
  values OPENING_STOCK, JOB_RETURN, REVERSAL) and
  `20260918140100_inventory_management` (one transaction): `Part.category`;
  `Purchase.supplierInvoiceNumber / supplierInvoiceDate / notes` with partial
  unique index `one_live_purchase_per_supplier_invoice`;
  `InventoryTransaction.reversalOfTransactionId` (FK, reversed at most once);
  CHECKs on the ledger (non-zero, sign by type, job movements name the part
  usage, receipts name the purchase line, reversals name the original) and on
  purchase lines/totals; trigger `inventory_transactions_append_only` refuses
  UPDATE/DELETE on the ledger.
- Stock is only ever the ledger sum. `src/lib/inventory/stock.ts`
  `postMovement()` is the single way stock moves: locks the part row, refuses
  negative stock. Job issue, receipts, adjustments, reversals and job returns
  all go through it.
- Services: `src/lib/inventory/{parts,suppliers,purchases,labels}.ts`;
  `returnPartFromJob` in `lib/workshop/repair.ts`. A part usage's net quantity
  (fitted − returned, from the ledger) is what repair progress, QC and billing
  use.
- Screens: `/inventory/parts` (search, filters, low/out-of-stock), part
  detail (stock, history with running balance, adjust, reverse), suppliers,
  purchases (draft → partial/full receipt), `/inventory/movements`; "Take
  back" on the job card's parts list.
- Permissions added (dev seed grants them to Owner): `inventory.manage`,
  `purchase.create`, `purchase.receive`. Existing `inventory.adjust` covers
  adjustments/reversals; `inventory.issue` covers job issue and returns.

### Decisions awaiting approval (inventory)

1. Receiving at a different cost does not change the part's catalogue cost;
   the difference is shown. No FIFO / weighted-average costing.
2. Supplier outstanding = received value (cost + VAT) − supplier payments;
   supplier payments aren't recorded by the app yet.
3. Purchase receipts can't be reversed; return-to-supplier / supplier credit
   notes are not built. Only adjustments and opening stock are reversible;
   job parts are corrected with a job return (only while the job is in repair).
4. Stock is per branch — the user's primary branch. No transfers yet.
5. The 12 existing opening-stock rows stay as ADJUSTMENT (history not
   rewritten); new opening stock is OPENING_STOCK.

## Milestone: Ready → invoice → payment → paid → delivered — DONE (committed d47b169)

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

## Milestone: Repair → quality check → ready — DONE (committed d47b169)

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
  & RBAC UI**. The workshop/VAT half of Phase 11 is now done (see the top of
  this file); the role and permission management UI is not — enforcement
  already exists everywhere, but roles are still granted by SQL.
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
