# Authorization: Organization and Branch Scoping

Status: Phase 1 — describes schema-level guarantees and the backend
enforcement layer that implements them. Enforcement lives in
`src/lib/auth/authorize.ts` (`requirePermission()`/
`hasPermission()`), fed by `src/lib/auth/session.ts`
(`getCurrentUser()`), called from Server Actions and Server Components
directly (there is no separate API service — see
[ADR-008](../11-decisions/ADR-008-single-nextjs-application.md)). Every
Server Action that mutates data calls `requirePermission()` before touching
Prisma; this document defines the contract that code implements.

## Organization isolation

Every tenant-owned table carries `organization_id`. Every relation from a
child row to an organization-scoped parent is a **composite foreign key** on
`(organization_id, parent_id)` referencing the parent's
`(organization_id, id)`, not a plain `(parent_id) -> (id)` FK. This makes it
structurally impossible at the database level for a row to reference a
parent belonging to a different organization — Postgres rejects the
insert/update outright, regardless of what application code does.

This does **not** remove the need for backend enforcement: every query must
still be scoped to the authenticated user's `organization_id` (e.g. via a
required filter injected by the request-handling layer), because the
database constraint only prevents _inconsistent_ cross-organization links —
it does not prevent a correctly-scoped-to-its-own-org row from being read or
written by a caller from a _different_ organization who simply asks for it
by ID. That authorization check is entirely an application-layer
responsibility.

## Branch scoping via UserRole

`UserRole.branch_id` is nullable, with this meaning:

| `branch_id`              | Meaning                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `NULL`                   | The role grant applies **organization-wide** — the user has this role's permissions across every branch of the organization.         |
| set to a specific branch | The role grant is **scoped to that branch only** — the user has this role's permissions only for resources belonging to that branch. |

A user can hold multiple `UserRole` rows: some organization-wide, some
scoped to specific branches (e.g. "Accountant" org-wide, plus "Branch
Manager" scoped only to the Al Qusais branch).

### What the database guarantees

- A `UserRole` row's `user_id`, `role_id`, and `branch_id` (when set) are all
  guaranteed to belong to the same `organization_id` as the grant itself
  (composite FK, see above) — a branch-scoped grant can never silently point
  at a branch from a different organization.
- Exactly one grant per `(user, role)` pair at the organization-wide scope,
  and exactly one grant per `(user, role, branch)` at branch scope — enforced
  by two unique constraints (one of them a partial index on
  `branch_id IS NULL`, since Postgres treats `NULL` as distinct from itself
  in ordinary unique constraints).

### What the backend MUST still enforce

The database has no concept of "this request is for branch X" — that is a
runtime fact about the incoming request, not a schema-level property. The
backend authorization layer must, for every request touching a
branch-specific resource (e.g. a `JobCard`, `Appointment`, `Purchase`,
`Invoice`, `Attendance`):

1. Resolve the resource's `branch_id`.
2. Load the authenticated user's effective `UserRole` grants for the
   required permission.
3. Allow the request only if at least one matching grant is either
   organization-wide (`branch_id IS NULL`) or scoped to that exact
   `branch_id`.
4. Reject (403), do not silently filter, when no matching grant covers that
   branch — a branch-scoped user must not be able to discover the
   _existence_ of another branch's data via inference (e.g. distinguishing
   "not found" from "forbidden" in a way that leaks information), so
   resources outside a user's branch scope should return the same response
   as a genuinely nonexistent resource.

This check is implemented once, in `requirePermission()`
(`src/lib/auth/authorize.ts`), not duplicated per Server Action.
`getCurrentUser()` (`lib/auth/session.ts`) loads the caller's effective
grants — split into org-wide permission codes and a `Map<branchId, Set<code>>`
of branch-scoped ones — once per request, and `requirePermission(user, code,
{ branchId })` checks against both. Phase 1 only exercises this for
`job_card.create`/`job_card.edit` (Quick Check-In, job status transitions);
every later module must call it the same way before its first Prisma write.
