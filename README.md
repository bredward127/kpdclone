# KDP Kids Book Studio

KDP Kids Book Studio is an externally hosted Node/TypeScript application for planning illustrated children’s books. This bootstrap replaces browser-only project persistence with authenticated, server-backed project data while preserving the Maker’s Ledger visual direction.

## Architecture

The application is an Express server with typed tRPC procedures, a React/Vite client, and a SQLite-compatible persistence layer. The minimum schema contains only `users` and `projects`; the generated SQL is recorded in `migrations/0001_initial.sql` and the runtime bootstrap applies the same idempotent DDL on startup.

All project procedures are `protectedProcedure` calls scoped to the current user. The client uses tRPC hooks rather than raw REST fetch wrappers. Private project data is never read from `localStorage`.

Authentication supports two deployment modes:

1. In production, place the server behind a trusted authentication proxy and set `TRUSTED_AUTH_PROXY=true`. The proxy must authenticate the request and inject `x-authenticated-user-id`, with optional name and email headers. The application persists only the current user’s identity and uses project ownership checks for every project operation.
2. In non-production environments, `/auth/dev-login` issues a signed, HTTP-only development session cookie. Set `SESSION_SECRET` for realistic local testing. This route is disabled when `NODE_ENV=production`.

Set `SESSION_SECRET` in deployment secrets. No FAL integration or FAL key is included in this phase.

## Routes

The shell exposes explicit routes for Projects, Book Brief, Blueprint, Page Studio, Cover Desk, Validation, and Exports. Project routes use `/projects/:projectId/:section`. The section surfaces intentionally remain feature placeholders until their dedicated implementation steps.

## Local commands

```bash
pnpm install
pnpm check
pnpm test
pnpm build
NODE_ENV=development ENABLE_DEV_AUTH=true pnpm dev
```

For a local authenticated browser session during development, open `/auth/dev-login`, which redirects to the Projects route. For production, use the configured trusted authentication proxy rather than the development login.

## Scope intentionally deferred

This phase does not call FAL, generate PDFs, create private object-storage adapters, or add page/asset/job/package tables. The production workflow will later add those capabilities behind the small asynchronous queue and explicit page-level approval boundary.
