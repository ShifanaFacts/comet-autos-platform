# ADR-008: Single Next.js Application (supersedes ADR-007)

Status: Accepted
Date: 2026-09-16

## Context

[ADR-007](./ADR-007-nextjs-nestjs-separation.md) set up a two-application
architecture (`apps/web` Next.js presentation layer calling `apps/api`
NestJS for all business logic and data access), justified by the premise
that Comet Autos would grow into a multi-tenant SaaS platform serving
multiple independent clients (web, future mobile app, customer portal,
third-party integrations) that all needed a shared, client-agnostic API
boundary.

The product owner has corrected that premise directly: **Comet Autos is not
a SaaS product.** It is a dedicated internal workshop management
application for one business — the Comet Autos workshop in Al Qusais,
Dubai. There is no roster of external tenants or third-party API consumers
to design a stable client-agnostic boundary for. The `apps/api` NestJS
service existed only as a health-check scaffold at the time of this
decision (no business logic had been built against it yet), so reversing
course cost nothing beyond documentation and wiring.

## Decision

- **One deployable application**: Next.js (repo root), using Server
  Components, Server Actions, and Route Handlers for both UI and business
  logic.
- Prisma is called directly from Server Actions/Route Handlers/Server
  Components — there is no separate REST/HTTP API boundary between the web
  app and the database.
- The data flow is:
  `Browser → Next.js → Server Actions / Route Handlers → Business Services → Prisma → PostgreSQL`.
- `apps/api` (NestJS) and `packages/shared` have been deleted. The Prisma
  schema (`prisma/schema.prisma`, unchanged in location and content except
  for additive-only changes — see PROJECT-STATUS.md) now generates its
  client into `src/generated/prisma`.
- Business logic that would previously have lived in a NestJS service/module
  now lives in plain TypeScript modules under `src/lib/` (e.g.
  `lib/auth/`, `lib/workshop/`), called directly from Server Actions —
  still centralized, still not duplicated per-caller, just without an HTTP
  hop in between.

## Why this is the right call for Comet Autos specifically

- **No multi-client requirement in practice.** The only client is the
  Comet Autos staff web app, plus (per the customer-approval/invoice-access
  requirements) a small set of public, token-scoped Next.js routes — both
  of which are naturally served by one Next.js application. There is no
  mobile app, third-party integrator, or separate tenant today that would
  benefit from a standalone API.
- **Less to build and operate.** One deployable service, one dev server,
  one set of environment variables, no HTTP boundary to version, secure,
  and keep in sync between two codebases — directly serving the instruction
  to avoid SaaS-shaped complexity (tenant onboarding, organization
  switching, platform admin, etc. are explicitly out of scope).
- **Authorization is still centralized**, just at a different layer:
  `lib/auth/authorize.ts`'s `requirePermission()` is called at the start of
  every Server Action/protected Server Component, mirroring what a NestJS
  guard would have enforced — see `docs/07-security/authorization.md`.
- **If a real second client ever appears** (a native mobile app, a genuine
  third-party integration), Route Handlers under `src/app/api/`
  can expose exactly the endpoints that client needs at that time, reusing
  the same `lib/` business-service functions Server Actions already call —
  this decision does not foreclose that path, it just stops building for it
  speculatively today.

## What stays true from ADR-007

The underlying database design principles ADR-007 didn't set (tenant/branch
isolation via composite FKs, RBAC via `UserRole`, audit logging, immutable
financial/inventory ledgers) are entirely a property of `prisma/schema.prisma`
and are unaffected by this decision — see the schema's own header comment
and `docs/07-security/authorization.md`.
