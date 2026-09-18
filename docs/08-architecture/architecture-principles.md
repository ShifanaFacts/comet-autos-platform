# Architecture Principles

Status: Phase 1 (foundation + first vertical slice). Describes the
architecture as of the single-Next.js-application pivot
([ADR-008](../11-decisions/ADR-008-single-nextjs-application.md)). Will grow
as further modules are built — see `PROJECT-STATUS.md` for the roadmap.

## System shape

Comet Autos is a **single deployable Next.js application**, not a SaaS
platform:

- **src/** — Next.js 16 + TypeScript, at the repo root. The entire
  application: UI, routing, Server Actions, Route Handlers, and business
  logic.
- **PostgreSQL**, accessed exclusively through **Prisma**
  (`src/lib/prisma.ts`), called directly from Server
  Components/Actions/Route Handlers — there is no separate backend service.
- **prisma/** at the repo root — the schema (single source of truth) and
  migrations. Client generates into `src/generated/prisma`
  (gitignored build artifact).

## The data-flow rule

```
Browser → Next.js (Server Components / Server Actions / Route Handlers) → lib/ business services → Prisma → PostgreSQL
```

Business logic lives in plain TypeScript modules under `src/lib/`
(e.g. `lib/auth/`, `lib/workshop/`, `lib/numbering.ts`) — centralized and
reused across every Server Action that needs it, the same way a NestJS
service would have been, just without an HTTP hop to reach it.

## Multi-tenant, multi-branch, RBAC

The schema (`prisma/schema.prisma`) retains `Organization`/`Branch`/`User`/
`Role`/`Permission` models for internal access control (multiple staff
roles, one workshop with room for more branches later), **not** for
multi-tenant SaaS. In practice there is exactly one `Organization` row
(Comet Autos) and one `Branch` row (Al Qusais) — see `prisma/seed.ts`.

RBAC is enforced via `UserRole` grants (organization-wide or branch-scoped)
checked against the `Permission` catalog — see
`docs/07-security/authorization.md` for the full contract, and
`src/lib/auth/authorize.ts` for the enforcement code.

## Security boundary

- Authorization is enforced server-side in `lib/auth/authorize.ts`
  (`requirePermission()`), called at the start of every protected Server
  Action/Server Component — never inferred from hiding UI elements.
- `src/proxy.ts` (Next.js's Edge "Proxy", formerly "Middleware")
  only does a cheap cookie-presence check for UX redirects; it cannot run
  Prisma's Node driver adapter in the Edge runtime, so it is **not** the
  real security boundary. The real check happens in `requireUser()`/
  `requirePermission()`, which run in the Node.js runtime on every request.
- `DATABASE_URL` is server-only (`.env`, gitignored), never
  sent to the browser.
- Session auth is self-hosted (`lib/auth/session.ts`): random session
  tokens, only their SHA-256 hash stored in the `Session` table, `httpOnly`
  cookies. See `docs/integrations.md` — no external auth provider is used
  or required for V1.
- Customer-facing resources (future quotation/invoice links) use scoped,
  expiring, revocable `CustomerAccessToken` rows — one token per resource,
  never a general customer login. Not yet built; see PROJECT-STATUS.md.

## What's intentionally not built yet

See `PROJECT-STATUS.md`'s Roadmap section for the full module-by-module
list (Inspection/Diagnosis, Estimates + customer approval, Invoicing/
Payments, Inventory/Purchasing, Finance/Accounting, HR/Payroll, Reports,
Settings/RBAC UI, customer portal, notifications, object storage,
import/export, PDF/print).
