# Layered test report

## Scope

This report covers the production workflow test layers for KDP Kids Book Studio. The named fixture is `fixture-coloring-book-24`, a 24-page, 8.5 by 11 inch, left-to-right children’s coloring book with one cover plan.

## Executed evidence

| Layer | Command or artifact | Result | Evidence |
|---|---|---|---|
| Unit | `npm test` | Passed | 14 test files and 65 tests passed. Coverage includes prompt composition, ownership, lifecycle transitions, asset quality, interior geometry, cover geometry, KDP preflight, metadata, provenance, and archive manifests. |
| Mock-FAL integration | `tests/fal-generation.test.ts`, `tests/fal-security.test.ts` through `npm test` | Passed | 10 generation lifecycle tests and 4 security tests passed, including queue submission, in-progress/completed handling, result retrieval, duplicate webhook idempotency, cancellation, reconciliation, retry, provider errors, and webhook verification. |
| Browser E2E | `e2e/creator-workflow.spec.ts` | Implemented, opt-in | The authenticated creator workflow is specified from Projects through owner download. It is skipped unless `RUN_BROWSER_E2E=1` and a configured authenticated test server are supplied. |
| Live FAL smoke | `scripts/fal-smoke.ts` | Implemented, not run | Disabled in CI and by default. It requires explicit confirmation, `FAL_KEY`, and an administrator-reviewed `FAL_SMOKE_ENDPOINT`; it submits exactly one request, does not retry, removes the disposable local result, and only prints the provider request ID when `FAL_SMOKE_ADMIN=1`. |
| Type safety | `npm run check` | Passed | TypeScript completed with no errors. |
| Production build | `npm run build` | Passed | Vite client and bundled server completed successfully. |

## Acceptance workflow

The acceptance contract is defined in `tests/fixtures/coloring-book-24.ts` and consumed by the browser workflow specification. The expected sequence is project creation, brief save, one reference upload, prompt composition, one-page generation, human approval, assembly of an approved fixture page set, interior PDF creation, full-wrap cover PDF creation, KDP preflight, ZIP creation, and owner-authorized download of every expected artifact. The server-side package tests verify the required archive layout and owner-scoped artifact access; the browser specification verifies the creator-facing route progression when an authenticated environment is available.

## Security evidence

The live smoke path refuses to run in CI, requires a literal operator confirmation, never prints the API key, never places it in a fixture or report, and suppresses the provider request ID for non-administrative runs. Browser and server actions remain owner-scoped. Archive and report files are private-storage references with short-lived access URLs rather than public file paths.

## Known limitations

The browser E2E suite requires a running test server, an authenticated test identity, and installed Playwright browser binaries; those environment-specific dependencies are intentionally not invoked by the default deterministic suite. The live FAL smoke test was not run because it requires an operator-supplied real credential, an approved inexpensive endpoint, explicit confirmation, and network/provider availability. The fixture contract and server integration layers are implemented, but a fully automated authenticated browser acceptance run remains environment-gated. The system does not claim FAL or KDP acceptance; provider behavior, KDP Print Previewer, and KDP review remain external authorities.
