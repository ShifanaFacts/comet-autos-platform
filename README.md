# Comet Autos

Workshop Management System for Comet Autos (Al Qusais, Dubai), built as the first
tenant of a future multi-tenant SaaS platform.

This repository is currently at the **foundation stage**: monorepo scaffolding,
tooling, and a health-checked connection between the web app and the API. No
business modules (customers, vehicles, job cards, invoicing, etc.) exist yet.

See [PROJECT-STATUS.md](./PROJECT-STATUS.md) for what has been built so far and
[docs/08-architecture/architecture-principles.md](./docs/08-architecture/architecture-principles.md)
for the architectural rules this codebase follows.

## Architecture

```
Browser → Next.js (apps/web) → NestJS REST API (apps/api) → Prisma → PostgreSQL
```

- **apps/web** — Next.js + TypeScript presentation layer.
- **apps/api** — NestJS + TypeScript application/API layer. Owns all database access.
- **packages/shared** — TypeScript types/utilities shared between web and api.
- **prisma/** — Prisma schema (source of truth for the database), owned by apps/api.
- **docs/** — Business, architecture, and decision documentation.

The Next.js app never talks to PostgreSQL or Prisma directly. See
[ADR-007](./docs/11-decisions/ADR-007-nextjs-nestjs-separation.md) for why.

## Prerequisites

- Node.js >= 20
- npm >= 10 (this repo uses npm workspaces)
- A PostgreSQL database (local or cloud) — see below for a local option

## Getting started

```bash
npm install
```

Copy the environment templates and fill in real values:

```bash
cp .env.example .env                       # used by the Prisma CLI (root)
cp apps/api/.env.example apps/api/.env      # used by the running API
cp apps/web/.env.local.example apps/web/.env.local  # used by the running web app
```

### Local PostgreSQL

If you don't already have PostgreSQL running locally, start the bundled
development instance (a real native Postgres binary, not a system install):

```bash
npm run db:start
```

Leave this running in its own terminal. It listens on `localhost:5432` and
creates the `comet_autos_dev` database automatically. Data persists under
`.local-postgres-data/` (gitignored) between restarts. Stop it with
`npm run db:stop` (or Ctrl+C in its terminal). This is local-development-only
tooling — production environments use a real managed PostgreSQL instance.

If you have your own PostgreSQL (local install, Docker, or cloud), just point
`DATABASE_URL` in `.env` and `apps/api/.env` at it instead and skip this step.

Generate the Prisma Client (no database models exist yet, but the client/config
are already wired up):

```bash
npm run prisma:generate
```

### Run the API (NestJS)

```bash
npm run dev:api
```

Runs on `http://localhost:3001` by default. Verify it's up:

```bash
curl http://localhost:3001/health
```

### Run the web app (Next.js)

```bash
npm run dev:web
```

Runs on `http://localhost:3000`. The home page performs a server-side fetch to
the API's `/health` endpoint and shows whether the connection succeeded.

## How Next.js talks to NestJS

`apps/web/src/lib/api-client.ts` is a server-only HTTP client that reads the API's
base URL from the `API_BASE_URL` environment variable (not exposed to the
browser). Server Components and Server Actions call functions from this module
to reach the NestJS REST API. Next.js does not import Prisma or connect to
PostgreSQL directly — see
[ADR-007](./docs/11-decisions/ADR-007-nextjs-nestjs-separation.md).

## Other scripts

| Script                            | Description                          |
| --------------------------------- | ------------------------------------ |
| `npm run build:web` / `build:api` | Production build for each app        |
| `npm run lint:web` / `lint:api`   | Lint each app                        |
| `npm run format` / `format:check` | Prettier across the whole repo       |
| `npm run prisma:validate`         | Validate `prisma/schema.prisma`      |
| `npm run db:start` / `db:stop`    | Local embedded PostgreSQL (dev only) |

## Environment variables

See `.env.example`, `apps/api/.env.example`, and `apps/web/.env.local.example`.
Never commit `.env`, `.env.local`, or any file containing real credentials.
