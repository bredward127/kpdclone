# Operational Recovery Runbook

## Operating principles

All operational controls are administrator-only and aggregate by design. The recovery console exposes one selected target at a time. It never offers retry-all, requeue-all, prompt inspection, asset inspection, private download URLs, credentials, or provider secrets.

A daily cleanup job should call the bounded cleanup procedure. It expires preview/package records whose retention deadline has passed, deletes their private objects when possible, removes cancelled draft asset objects older than seven days, and reports objects that require a later retry. Provider result URLs are intentionally not persisted as durable assets; once a result is copied into private storage, only the durable storage reference remains.

## Missed webhook

Open **Operations / Admin**, select the incomplete generation job, and choose **Reconcile once**. The server verifies that the job belongs to an existing account, has a provider request ID, and is not terminal before making one provider status request. If the provider reports a completed result, the normal server-side download, validation, and private-storage ingestion path runs. If the request is still active, leave it for a later scheduled review; do not repeatedly click reconcile.

## Expired provider asset URL

An expired provider URL is not retried as a browser download. The generation job is marked with the safe `result_download_expired` or `result_download_rejected` classification by the server-side adapter. An administrator may use the job’s bounded retry action only when the provider request is still safely retryable. If the provider result is no longer available, create a new page-level generation request from an approved immutable prompt version. Never promote a transient URL to a project asset.

## Failed ZIP export

Confirm that the selected validation run is complete with no blocking findings and that the interior and cover artifact records remain completed. If the export package contains an immutable recovery snapshot, select that one package and choose **Regenerate frozen export**. The server replays the stored input against the frozen artifact/version references and creates a new package; it does not delete prior valid exports. If source artifacts are missing or the frozen version is stale, rebuild those artifacts through the normal workflow instead of attempting a bulk retry.

## Accidental page-count change

Do not reuse the old cover template. Update the interior page count, invalidate the cover plan, import a current official calculator/template output, confirm that its inputs match the finalized interior, and rerun preflight. A final package must use the refreshed template fingerprint and a newly computed frozen project version.

## KDP preflight failure

Use the traceable report to identify each blocking rule, page, or cover region. Correct the source asset, placement, typography, pagination, margins, bleed, barcode clearance, font, provenance, or template issue named by the report. Rerun preflight after the correction. Export remains blocked until there are no blocking findings; the application never claims that KDP acceptance is guaranteed.

## Storage-copy failure

Only a row explicitly marked `retryable` with fewer than three attempts is eligible for **Retry safe copy**. The server copies from the recorded private source reference to the recorded destination reference, updates the operation atomically, and records a recovery event. Failed or abandoned operations remain visible for operator review. There is no retry-all action.

## Evidence and retention

Review the aggregate dashboard for provider error codes, webhook pending counts, export outcomes, storage failures, and validation categories. Audit events record project creation, brief changes, prompt versions, generation submissions, provider callbacks, asset decisions, exports, and destructive deletion markers. Audit metadata excludes prompts, artwork, signed URLs, keys, and provider authorization values.
