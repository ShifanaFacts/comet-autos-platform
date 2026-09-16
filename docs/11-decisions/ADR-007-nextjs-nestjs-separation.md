# ADR-007: Next.js / NestJS Separation

Status: **Superseded by [ADR-008](./ADR-008-single-nextjs-application.md)**
on 2026-09-16 — Comet Autos is a single-business internal application, not
a multi-tenant SaaS platform, so the premise below (a client-agnostic API
boundary for multiple future clients) no longer applies. Kept as historical
record of the reasoning at the time; do not follow this ADR for new work.

Date: 2026-09-15

## Context

Comet Autos is being built as a modular monolith that must remain workable as
it grows into a multi-tenant SaaS platform serving a web app, a future mobile
app, a future customer portal, AI-assisted workflows, and UAE e-invoicing
integrations. We need one clear application/API boundary that all of those
clients can share, rather than each client re-implementing business logic and
database access independently.

## Decision

- **Next.js** (`apps/web`) is the presentation/web application only. It
  renders UI, handles routing, and calls the NestJS API over HTTP for any
  business data or business operation.
- **NestJS** (`apps/api`) is the single, dedicated backend/API. It owns all
  business logic, all database access (via Prisma), and is the only place
  authorization is enforced.
- Next.js Server Components and Server Actions **do not** access Prisma or
  PostgreSQL directly for core Comet Autos business operations, even though
  the framework technically allows a Server Action to import a database
  client directly. Server Actions are permitted for presentation-layer
  concerns (e.g. calling the NestJS API, form handling), but never as a
  shortcut around the API boundary.
- The data flow is fixed as:
  `Browser → Next.js → NestJS REST API → Application/Domain services → Prisma → PostgreSQL`.

## Why Next.js for the web/presentation layer

Next.js gives us server-rendered and static UI, routing, and a good developer
experience for the workshop-facing web app, with a clear place (Server
Components) to fetch data server-side without exposing internal endpoints or
credentials to the browser.

## Why NestJS as the dedicated backend/API

NestJS provides an opinionated, modular structure (modules, controllers,
providers, dependency injection) that maps directly onto the planned domain
modules (Auth, Organizations, Branches, Customers, Vehicles, Workshop,
Inventory, Invoicing, Accounting, HR, etc.), while remaining one deployable
service — a modular monolith, not a collection of microservices. This gives
us a single, enforceable place for authorization, validation, audit logging,
and multi-tenant/multi-branch data scoping, all of which are cross-cutting
concerns that must not be duplicated per-client.

## Why Server Actions do not directly access Prisma for core business operations

If Server Actions were allowed to query Prisma directly, business logic and
authorization checks would end up duplicated (or worse, inconsistently
implemented) between Next.js and NestJS. It would also mean any future client
that isn't Next.js (mobile app, customer portal, third-party integrations)
would not benefit from that logic and would need it re-implemented, or would
need to bypass Next.js entirely — undermining the point of having a single
API boundary. Keeping Prisma exclusively behind the NestJS API means there is
exactly one place where business rules, tenant/branch scoping, and
authorization are enforced, regardless of which client is calling.

## How this supports future mobile, customer portal, AI, and integrations

Because all business logic and data access live behind one REST API, any
future consumer — a mobile app, a customer-facing portal, an AI agent, or a
UAE e-invoicing integration — can call the same NestJS endpoints the web app
uses, under the same authorization rules, without needing direct database
access or duplicated logic. Next.js is just one client of that API, not a
privileged one.

## Why this remains a modular monolith rather than microservices

At this stage, a single Comet Autos workshop (soon to become a small number of
tenants) does not have the scale, team size, or operational need that would
justify the deployment and coordination overhead of microservices (separate
deployments, network calls between domains, distributed transactions, service
discovery). A modular monolith gives us clear module boundaries inside NestJS
now, which can be extracted into separate services later _if_ scale or team
structure ever requires it — without paying that cost prematurely.
