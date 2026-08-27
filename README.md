# KDP Kids Book Studio

KDP Kids Book Studio is an externally hosted Node/TypeScript application for planning illustrated children’s books. This bootstrap replaces browser-only project persistence with authenticated, server-backed project data while preserving the Maker’s Ledger visual direction.

## Architecture

The application is an Express server with typed tRPC procedures, a React/Vite client, and a SQLite-compatible persistence layer. The minimum schema contains only `users` and `projects`; the generated SQL is recorded in `migrations/0001_initial.sql` and the runtime bootstrap applies the same idempotent DDL on startup.

All project procedures are `protectedProcedure` calls scoped to the current user. The client uses tRPC hooks rather than raw REST fetch wrappers. Private project data is never read from `localStorage`.

Authentication supports two deployment modes:

1. In production, place the server behind a trusted authentication proxy and set `TRUSTED_AUTH_PROXY=true`. The proxy must authenticate the request and inject `x-authenticated-user-id`, with optional name and email headers. The application persists only the current user’s identity and uses project ownership checks for every project operation.
2. In non-production environments, `/auth/dev-login` issues a signed, HTTP-only development session cookie. Set `SESSION_SECRET` for realistic local testing. This route is disabled when `NODE_ENV=production`.

Set `SESSION_SECRET` and `FAL_KEY` in deployment secrets. Set `FAL_ADMIN_USER_IDS` to a comma-separated allowlist of authenticated user IDs allowed to run the masked FAL connection check and inspect the reviewed model registry. The server validates `FAL_KEY` at production startup and fails with an actionable operator message if it is absent. The FAL status action performs only a bounded account-safe model-list request and returns a masked status; it never returns the key. The client never receives or stores the key.

The current registry contains `fal-ai/gpt-image-1.5` based on the reviewed official documentation recorded in `docs-fal-model-review.md`. It is inactive by default, and its pricing display fields are nullable because the reviewed page did not provide a stable provider price. An administrator must explicitly review the current official documentation before activating any endpoint.

No FAL model generation call is included in this phase.

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

## Normalized studio schema

Migration `migrations/0002_studio_schema.sql` upgrades the original project shell into the normalized studio model. Run `pnpm db:migrate` during deployment or release operations; the command is idempotent and records applied versions in `schema_migrations`. It creates `book_briefs`, `book_blueprints`, `page_plans`, `prompt_versions`, `generation_jobs`, `generated_assets`, `asset_variants`, `cover_plans`, `layout_templates`, `export_packages`, `validation_runs`, and `audit_events`, plus relational link tables for project, page, and prompt visual references. Every entity uses a stable text ID, a user ownership column, foreign keys, lifecycle checks, and UTC timestamps. File bytes are never stored in the database; artifact tables store private-storage references, checksums, dimensions, MIME types, and byte sizes only.

The lifecycle graph is defined in `shared/studio.ts`. Protected procedures and helpers require the current user ID in every project-scoped query and write. Invalid job or asset transitions are rejected, page rejection requires a reason, and successful lifecycle transitions create audit events. The current task does not call FAL or generate PDFs.

## Deterministic prompt composition

The Page Studio prompt composer builds a complete generation request from the saved project, brief, character bible, visual anchors, page plan, rights-attested active references, and a small set of page-specific edits. It emits explicit sections for book identity, intended audience, continuity, page scene, visual style, composition, print-safe requirements, negative constraints, and model parameters. Earlier decisions are read from server-backed project records rather than re-entered for each page.

Each composed request is persisted as an immutable `prompt_versions` record with a source-field snapshot, verbatim user edits, endpoint/model/aspect-ratio/seed values, eligible reference IDs, explainable lint warnings, and a deterministic SHA-256 content hash. The prompt history UI provides side-by-side comparison and restores a selected version by creating a new version linked to the original; it never mutates an existing snapshot.

Prompt linting reports warnings for missing subjects, vague visual style, inconsistent age declarations, unsupported visual references, protected brand/copyright requests, living-artist style imitation, sexualized child/minor content, and conflicting print constraints. Warnings include a code, message, evidence, and section. Linting does not silently rewrite user text. This phase does not call FAL or generate images.

## Asynchronous FAL generation

FAL generation is server-only. Protected typed procedures accept a project, page plan, approved immutable prompt version, endpoint parameters, selected reference IDs, and expected output constraints. The server verifies ownership and that the prompt version is explicitly frozen (`approved`) before submitting to the FAL queue. It stores the local job first, then persists the FAL `request_id` immediately and returns the local job ID plus provider request ID to the caller. Browser code never calls FAL.

The local job tracks local/provider status, provider request identity, model inputs, queue timestamps, retry count, error classification, cancellation requests, source prompt version, and expected output constraints. Cancellation marks `cancellation_requested` before passing cancellation to FAL when possible. Reconciliation checks one known provider request only; it does not start a polling loop.

The webhook endpoint is disabled unless `FAL_WEBHOOK_ENABLED=true` and an HTTPS `FAL_WEBHOOK_URL` are configured. The implementation follows the current official FAL ED25519/JWKS signature mechanism with a five-minute timestamp window and a maximum 24-hour JWKS cache. Valid callbacks are acknowledged quickly, then processed idempotently by provider request ID. Result URLs are treated as transient: supported image bytes are downloaded server-side, validated, checksummed, and written to private storage before a durable `generated_assets` record is created.

The provider queue migration is `0005_fal_generation_queue.sql`. No FAL credential is stored in database rows, logs, tests, or client bundles.
