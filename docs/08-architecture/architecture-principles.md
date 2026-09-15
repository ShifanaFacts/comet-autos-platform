# Architecture Principles

Status: Foundation stage. This document describes the architectural rules
implemented so far. It will grow as further modules are approved and built.

## System shape

Comet Autos is built as a **modular monolith**:

- **apps/web** — Next.js + TypeScript. Presentation/web application only.
- **apps/api** — NestJS + TypeScript. The single application/API/business-logic
  boundary. Organized as domain modules within one deployable service (not
  microservices).
- **PostgreSQL**, accessed exclusively through **Prisma**, exclusively from
  **apps/api**.
- **packages/shared** — TypeScript types/utilities shared between the two apps
  (no business logic, no database access).

## The data-flow rule

```
Browser → Next.js → NestJS REST API → Application/Domain services → Prisma → PostgreSQL
```

Next.js **must not** access PostgreSQL or Prisma directly, in any form
(including Server Actions). All reads and writes of business data go through
the NestJS REST API. See
[ADR-007](../11-decisions/ADR-007-nextjs-nestjs-separation.md) for the
rationale.

Server Components and Server Actions in Next.js may be used for presentation
concerns (e.g. calling the NestJS API, handling form submissions that forward
to the API), but they do not bypass the API boundary for core business
operations.

## Multi-tenant, multi-branch, RBAC (forward-looking)

The platform is designed so that Comet Autos is the first organization/tenant
of a future SaaS product. Multi-tenancy, multi-branch, and RBAC are
architectural requirements for the eventual domain model, but **no tenant,
branch, role, or permission tables exist yet** — they must be designed and
approved before implementation (see `docs/03-domain/` and `docs/05-database/`
once populated).

## Security boundary

- Authorization is enforced in the NestJS backend, never inferred from
  hiding UI elements in the frontend.
- Database credentials (`DATABASE_URL`) are server-side only and never sent to
  the browser. The Next.js app only knows the NestJS API's base URL
  (`API_BASE_URL`, a server-only environment variable).
- Environment configuration is validated at API boot (`apps/api/src/config/env.validation.ts`);
  the process fails fast if required variables are missing, rather than
  failing confusingly later.
- Unhandled errors in the API do not leak internal details or stack traces to
  clients (NestJS's default exception handling already enforces this; no
  custom override was needed for the foundation).
- CORS on the API is restricted to the configured web app origin
  (`WEB_APP_URL`), not left open.

## What's intentionally not built yet

Per the current implementation scope, the following are explicitly out of
scope until separately approved: authentication, RBAC enforcement, business
domain modules (Customers, Vehicles, JobCards, Invoicing, Inventory, HR,
Accounting, etc.), object storage for documents/photos, and audit logging.
Their eventual design must live in the corresponding `docs/` subfolders before
implementation.
