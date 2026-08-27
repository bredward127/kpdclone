# KDP Kids Book Studio layered test plan

## Named fixture

The canonical acceptance fixture is `fixture-coloring-book-24`: a 24-page, 8.5 by 11 inch, left-to-right children’s coloring book with one cover plan. Its constants live in `tests/fixtures/coloring-book-24.ts` and are intentionally shared by acceptance and browser tests.

## Test layers

| Layer | Scope | Repository coverage | Default execution |
|---|---|---|---|
| Unit | Prompt composition, ownership, lifecycle transitions, print geometry, asset quality, cover composition, KDP rules, metadata, provenance, and archive manifests | `tests/prompt-composer.test.ts`, `tests/schema-and-lifecycle.test.ts`, `tests/asset-quality.test.ts`, `tests/cover-composer.test.ts`, `tests/kdp-preflight.test.ts`, `tests/publishing.test.ts`, `tests/export-center.test.ts` | `npm test` |
| Integration | Mock FAL submit/status/result/download transport, duplicate webhooks, reconciliation, cancellation, timeout/error classification, retry limits, and failed results | `tests/fal-generation.test.ts`, `tests/fal-security.test.ts` | `npm test` |
| Browser E2E | Authenticated creator route progression, project creation, brief/page/cover/validation/export stations, human-review visibility, and owner-download surface | `e2e/creator-workflow.spec.ts` | Opt-in: `RUN_BROWSER_E2E=1 npm run test:e2e` |
| Live smoke | Exactly one inexpensive FAL image against an administrator-reviewed endpoint, with explicit confirmation and disposable cleanup | `scripts/fal-smoke.ts` | Never in CI; `LIVE_FAL_SMOKE=1 CONFIRM_LIVE_FAL=GENERATE_ONE_TEST_IMAGE FAL_SMOKE_ENDPOINT=... npm run test:live-fal` |

## Acceptance sequence

The full acceptance sequence is defined as a named contract in `FIXTURE_ACCEPTANCE_STEPS`. A complete environment run must create the fixture project, save the brief, upload one rights-attested reference, compose a page prompt, submit exactly one page generation, approve it, assemble the remaining approved fixture pages, build the interior and full-wrap cover PDFs, run preflight, create the ZIP, and download every expected owner-scoped artifact. The deterministic unit and integration suites cover the server-side gates and artifact layout; the browser suite covers the authenticated surface when an application server and test identity are supplied.

## Evidence requirements

A run report must include the command, timestamp, commit or working-tree revision, test counts, fixture identity, artifact names, export-package ID, validation-run ID, and owner authorization result. Provider request IDs from the live smoke test may be printed only when `FAL_SMOKE_ADMIN=1`; otherwise the script reports completion without the identifier. API keys are never included in reports or logs.

## Known limitations

Browser E2E requires a separately configured authenticated test server and browser installation; it is deliberately skipped unless opted in. The live smoke test cannot guarantee provider availability or KDP acceptance and performs no retry after a timeout. KDP Print Previewer and KDP’s own review remain the final publishing authority.
