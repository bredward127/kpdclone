# Release Prerequisites and Manuals

Reviewed: 2026-08-27

This document is the authoritative checklist for anything that must be configured, retrieved, or confirmed outside the application. A release is not considered operationally ready until every required row has an owner and a successful validation result.

## External setup and retrieval matrix

| Item | Status | Owner action outside the app | Source or setup location | In-app validation |
|---|---|---|---|---|
| `FAL_KEY` | Required for generation | Create a server-side deployment secret in the production secret manager. Never enter it in a browser form, database field, client bundle, log, screenshot, or downloadable artifact. | FAL account/provider secret management; deployment platform secret store | Administrator-only FAL connection status and startup validation. |
| `FAL_SMOKE_ENDPOINT` | Required only for live smoke | Select one inexpensive FAL image endpoint whose current official model documentation has been reviewed by an administrator, then configure its stable endpoint identifier as a deployment environment variable. | Current official FAL model documentation and the deployment environment | The smoke command refuses to run when this variable is absent. The selected endpoint must be active in the model registry. |
| FAL webhook public URL | Required when production callbacks are enabled | Deploy the HTTPS callback route and set `FAL_WEBHOOK_URL` to its public URL. Configure the provider webhook to use the current supported signature mechanism. | Public HTTPS deployment and current FAL webhook documentation | Production startup rejects missing or non-HTTPS callback configuration; invalid, replayed, or conflicting callbacks are rejected. |
| FAL webhook verification configuration | Required when callbacks are enabled | Configure the provider’s current verification material, such as the approved JWKS URL or documented signing secret, without placing it in application data. | Current official FAL webhook verification documentation | A signed test callback must verify; unsigned and malformed callbacks must fail. |
| Private storage | Required | Provision the production private object-storage backend or approved private filesystem, credentials, lifecycle policy, and backup policy. | Deployment/storage provider console | Upload, server-side result copy, signed access URL, deletion cleanup, and expired-object cleanup checks. |
| Application database | Required | Provision the production SQLite/database volume or externally managed database according to the deployment architecture, including encrypted backups and restore testing. | Deployment platform database/volume configuration | Run `pnpm db:migrate` from an empty database and verify all migrations apply in order. |
| HTTPS and domain | Required for production | Configure DNS, TLS certificates, secure cookies, and reverse-proxy forwarding. | Domain/DNS/TLS provider | Browser requests use HTTPS; secure headers and callback URL checks pass. |
| KDP cover template/calculator output | Required per cover plan | Retrieve the current official calculator/template output after trim, bleed, paper/ink, binding, and finalized page count are known. Upload the guide asset through the application and confirm the inputs match. | Official [KDP paperback cover help](https://kdp.amazon.com/help/topic/G201953020) and current KDP calculator/template flow | The imported template fingerprint, retrieval date, dimensions, zones, and finalized interior fingerprint are recorded. Page-count changes invalidate it. |
| KDP ruleset sources | Required before activating a ruleset | Administrator reviews current official KDP help/calculator pages, updates the date-stamped ruleset, records source URLs and review notes, and activates it. | Official KDP help pages listed in `docs/kdp-cover-requirements.md` and `docs/kdp-publishing-metadata-requirements.md` | Preflight refuses to run without an active administrator-reviewed ruleset. |
| Fonts | Required for deterministic typography | Supply permitted font files through the protected workflow and confirm licensing/permission. | Font vendor/license records held by the creator/operator | Final PDFs are checked for embedded permitted fonts. |
| Browser acceptance environment | Required for release sign-off, optional in CI | Install Playwright browser binaries, start an authenticated test server, configure `RUN_BROWSER_E2E=1`, and set `E2E_BASE_URL`. Provide a non-production test identity. | Project repository and deployment/test environment | Desktop/mobile workflow and accessibility suite completes without skips. |
| Live smoke authorization | Owner-gated | An authorized owner confirms `GENERATE_ONE_TEST_IMAGE`. The operator sets `LIVE_FAL_SMOKE=1`, the confirmation variable, `FAL_KEY`, and the reviewed endpoint. | This release conversation plus deployment environment | Exactly one disposable request runs, the result is cleaned up, and the key is not printed or persisted. |

## Commands and operator sequence

From a clean checkout, the operator should run `pnpm install`, configure the required deployment variables, run `pnpm db:migrate`, run `pnpm check`, run `pnpm test -- --run`, and run `pnpm build`. The browser acceptance command is `pnpm test:e2e` only after the authenticated test server and Playwright browser are available. The optional live smoke command is `pnpm test:live-fal` only with the explicit owner gate and all required FAL variables.

The operational cleanup command is `pnpm cleanup:operational`. Schedule it outside the browser, normally daily, with a service identity permitted to delete only expired exports and cancelled draft objects according to the retention policy. It is not a retry or requeue command.

## Manual-generation tab proposal

A future **Manuals** tab is useful, but it is not part of the current release checkpoint unless explicitly approved as a feature. Its purpose should be to generate operator and creator documentation from the actual saved project state, not to create another unbounded content-generation surface.

The first safe version should provide three manual types: a creator workflow guide, a project-specific production packet, and an operator recovery runbook. Each manual should include a generated-at timestamp, project/frozen-version identifier where relevant, active KDP ruleset version, template provenance, artifact checklist, rights and AI-disclosure checklist, and a clear statement that KDP Print Previewer and KDP review remain authoritative. The project-specific manual must use an immutable frozen project version and must not include prompts, private URLs, provider credentials, or unapproved assets unless the creator explicitly selects a safe redacted appendix.

The tab should support preview, deterministic Markdown/HTML export, version history, and explicit creator confirmation before distribution. It should not silently rewrite prompts, claim legal clearance, claim KDP acceptance, expose FAL configuration, or automatically publish documentation. A later implementation should reuse existing protected procedures, provenance data, validation reports, and export manifests rather than introducing a second project-memory model.

## Current release boundary

The current release may document and link to manuals, but it should not add a Manuals tab without a separate product-owner decision covering scope, allowed manual types, redaction rules, versioning, and export destinations. The missing `FAL_SMOKE_ENDPOINT`, unavailable Playwright browser binary, authenticated test server, production private storage, TLS/domain setup, and current provider verification configuration are external release prerequisites rather than application features.

## References

[1]: https://kdp.amazon.com/help/topic/G201953020 "Amazon KDP paperback cover requirements"
[2]: https://kdp.amazon.com/help/topic/G201857950 "Amazon KDP cover design requirements"
[3]: https://kdp.amazon.com/help/topic/G5HDYGP4BXLX4RUW "Amazon KDP barcode requirements"
[4]: https://kdp.amazon.com/help/topic/G200672390 "Amazon KDP metadata guidance"
[5]: https://kdp.amazon.com/help/topic/G201097560 "Amazon KDP publishing content guidance"
[6]: https://kdp.amazon.com/help/topic/G201298500 "Amazon KDP AI-generated content guidance"
[7]: https://kdp.amazon.com/help/topic/G201834170 "Amazon KDP ISBN guidance"
