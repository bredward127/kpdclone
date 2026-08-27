# Product Security and Data Retention Policy

## Scope and authorization

Every creator-facing tRPC procedure uses `protectedProcedure`, which requires an authenticated session. Project, page, prompt, generation-job, asset, cover, validation, export, provenance, and audit reads and mutations pass the authenticated user ID into owner-scoped database helpers. Private media delivery validates the signed URL, session user, storage reference, and active record together; a storage key alone is not an authorization grant.

## Abuse controls

Generation submission is limited to 12 requests per user per rolling minute, reference uploads to 20 per minute, export-producing mutations to 6 per minute, and policy-review/metadata mutations to 30 per minute. The bounded queue remains limited to two or three explicitly confirmed pages, and generation-side project/user concurrency checks remain authoritative. The FAL callback endpoint is limited to 120 requests per source IP per minute and rejects malformed or unauthenticated callbacks before processing.

## Provider callbacks

The callback path verifies the provider’s configured signature mechanism before parsing accepted events. Each valid payload is keyed by its provider `request_id` in `fal_webhook_events`, with a SHA-256 payload digest. A repeated request ID is rejected, and a request ID paired with a different payload is rejected as a conflict. Accepted callbacks are acknowledged quickly and processed asynchronously. The event ledger survives process restarts and is not dependent on in-memory state.

## Secrets and logs

`FAL_KEY` is server-only and is never returned by an API procedure, written to the database, or included in client code. Error logging uses redaction for provider keys, authorization values, secret/token fields, signed URL signatures, and expiration parameters. Logs should contain event names, stable internal identifiers where operationally necessary, and bounded counters rather than request bodies, raw prompts, signed URLs, or personal fields.

## Private media and downloads

Uploaded references, generated assets, template guides, PDFs, reports, and ZIP packages are private-storage objects. Access links are short-lived. Media responses set `X-Content-Type-Options: nosniff`, private caching, and safe inline filenames. Downloadable package endpoints must additionally use attachment disposition, `Cache-Control: private, no-store`, and a restrictive content-security policy.

## Deletion and retention

The project removal action first verifies ownership, collects only the project’s private-storage references, records a minimal deletion marker containing one-way hashes of the user and project IDs, and deletes the project in a transaction. Cascading foreign keys remove project records. It then attempts deletion of all collected private objects and reports whether cleanup completed or requires an operational retry. Raw filenames, prompts, artwork, signed URLs, provider keys, and project contents are not retained in the deletion audit record.

Deletion audit markers are retained only for security accountability and incident investigation. They contain no recoverable user or project identifier and no creative content. Private objects should be lifecycle-managed by the deployment’s storage retention policy; failed object deletions must be retried by the operator before considering the deletion complete. Existing valid exports are not deleted as a side effect of creating a newer export, but they remain subject to their configured expiry and retention status.

## Final review boundary

These controls reduce cross-user access, replay, abuse, and accidental disclosure risk, but they do not replace deployment-level controls. Production operators must use HTTPS, a managed secret store, protected database backups, storage lifecycle rules, alerting for repeated callback failures, and periodic dependency and provider-documentation review. KDP Print Previewer and KDP’s own review remain the final authority for upload acceptance.
