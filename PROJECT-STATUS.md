# Project Status

Last updated: 2026-09-15

## Stage: Foundation

This is the initial scaffolding of the Comet Autos monorepo. No business
domain modules are implemented yet. The goal of this stage was to prove the
architecture end-to-end: a Next.js app that talks to a NestJS API over HTTP,
with Prisma configured (but no schema) on the API side.

## What exists

- npm workspaces monorepo: `apps/web`, `apps/api`, `packages/shared`, `prisma/`, `docs/`.
- **apps/web**: Next.js 16 (App Router, TypeScript, ESLint), with a home page
  that server-side fetches `GET /health` from the API and displays the result.
- **apps/api**: NestJS 12 (TypeScript, ESLint, Vitest), with:
  - `GET /health` — liveness endpoint.
  - `ConfigModule` with a custom `validate()` that fails fast if required
    environment variables (currently `DATABASE_URL`) are missing.
  - `PrismaModule` / `PrismaService` — global provider wrapping a generated
    Prisma Client (via the `@prisma/adapter-pg` driver adapter). No models
    exist yet; this only proves the wiring.
  - CORS restricted to the configured `WEB_APP_URL` (defaults to the local
    Next.js dev origin).
- **prisma/schema.prisma**: datasource (PostgreSQL) + generator configuration
  only. Client is generated into `apps/api/src/generated/prisma` (gitignored).
- Shared Prettier config at the repo root; ESLint (flat config) in both apps.
- `.env.example` files for the root (Prisma CLI), `apps/api` (API runtime),
  and `apps/web` (web runtime) — no real secrets committed.

## What does NOT exist yet

- No business domain models (Customer, Vehicle, JobCard, Invoice, Inventory,
  Employee, etc.) — these require solution-architect-approved schema design.
- No authentication or authorization.
- No RBAC, multi-tenant, or multi-branch data model.
- No object-storage / document upload wiring.
- No audit logging.
- No UAE e-invoicing, mobile, or customer portal work.

## Verified working (manually, this session)

- `npm run build --workspace=apps/api` — passes.
- `npm run test --workspace=apps/api` — passes (scaffolded unit test).
- `npm run lint --workspace=apps/api` and `--workspace=apps/web` — pass.
- `npm run build --workspace=apps/web` — passes.
- `npm run format:check` — passes.
- Ran both dev servers locally and confirmed the web home page renders
  "Connected — GET /health responded at \<timestamp\>", proving the
  Browser → Next.js → NestJS path works over HTTP.

## Known issues / follow-ups for the solution architect

- `npm audit` reports 4 high-severity advisories, all transitive dependencies
  of the `prisma` CLI's `@prisma/config` package (`deepmerge-ts`, `mysql2`) —
  not used by our PostgreSQL-only runtime path, and only affect the dev-time
  CLI, not `@prisma/client` or the deployed API. `npm audit fix --force` would
  downgrade `prisma` to 6.19.3; left as-is pending an explicit decision, since
  we deliberately pinned the current stable 7.10.0 (8.0.0 is still an RC).
- Prisma v7 requires a driver adapter (`@prisma/adapter-pg` + `pg`) instead of
  the old bundled query engine — already wired into `PrismaService`.
- `apps/web` and `apps/api` intentionally use different TypeScript major
  versions (^5 and ^6 respectively) because that's what each framework's own
  scaffolding tool (`create-next-app`, `@nestjs/cli`) currently pins for
  compatibility. Not unified, since forcing a match risks breaking either
  tool's own tested configuration.

## Next steps (not started — needs architect sign-off)

Domain schema design and the first business module (per the V1 core domain
list) should be the next piece of work, once documentation under
`docs/03-domain/` and `docs/05-database/` is approved.
