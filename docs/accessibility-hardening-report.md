# Accessibility and usability hardening report

## Scope

This pass preserves the Maker’s Ledger paper-and-ledger visual identity while improving production-stage keyboard access, focus visibility, screen-reader naming, status announcements, destructive-action safety, and mobile reflow.

## Fixes implemented

| Finding | Fix | Evidence |
|---|---|---|
| Focus depended on browser defaults and was inconsistent across controls | Added a shared high-contrast `:focus-visible` treatment for links, buttons, inputs, textareas, selects, and dialogs. | `client/src/index.css` |
| Decorative status icons could be announced as noise | Marked status and navigation icons decorative and exposed text labels plus `aria-current="page"`. | `PageGenerationStudio.tsx`, `StudioLayout.tsx` |
| Job transitions were primarily visual | Added an atomic polite live region naming the affected page number and current status. | `PageGenerationStudio.tsx` |
| Generation errors lacked page context | Error feedback now prefixes the affected page number. | `PageGenerationStudio.tsx` |
| Project and reference deletion used immediate or browser-native confirmation | Added a reusable alert dialog with explicit destructive action, cancel path, Escape support, focus placement, and named description. | `ConfirmDialog.tsx`, `Projects.tsx`, `VisualReferenceDesk.tsx` |
| Stopping provider work lacked cost/reversibility context | Added warning confirmation for queued/in-progress generation cancellation. | `PageGenerationStudio.tsx` |
| Archiving an approved variant lacked an irreversible-action warning | Added warning confirmation that explains lineage is preserved but the active approved asset changes. | `PageGenerationStudio.tsx` |
| Stage navigation communicated active state mostly by color | Added `aria-current`, screen-reader current-stage text, and persistent project identity. | `StudioLayout.tsx` |
| Mobile evidence was not captured consistently | Added Playwright screenshot capture for desktop Export Center and 390×844 mobile Projects states. | `e2e/creator-workflow.spec.ts` |
| Automated accessibility coverage was absent | Added axe WCAG 2A/2AA scan to the opt-in browser suite. | `e2e/creator-workflow.spec.ts` |

## Responsive acceptance

The production shell retains the stage path, active project, status/approval actions, and download links at narrow widths through responsive grid/flex layouts and an explicit mobile viewport test. The browser suite is opt-in because it requires an authenticated test server and browser binaries.

## Manual script

The full keyboard and screen-reader script is in `docs/manual-a11y-test-script.md`. It covers tab order, visible focus, stage navigation, status announcements, page-specific errors, confirmation dialogs, approval gates, cover/validation controls, export links, 200% zoom, and mobile reflow.

## Screenshot evidence

When the browser suite is run with `RUN_BROWSER_E2E=1`, it writes `test-results/desktop-export-center.png` and `test-results/mobile-projects.png`. These are final-state screenshots captured after the hardening pass. Before-state screenshots were not generated from the prior implementation because no authenticated baseline browser session was available in the sandbox; the report therefore treats the code diff and final-state captures as the evidence boundary.

## Known limitations

Axe cannot assess whether a spoken status announcement is understandable, whether content is cognitively clear, or whether a screen-reader user experiences the intended reading order. The confirmation dialog provides Escape and initial focus but does not implement a complete focus trap across every browser/assistive-technology combination. VoiceOver, NVDA, browser zoom, and native mobile text scaling can differ by operating-system/browser version. KDP generation and export actions remain server-gated; this pass does not replace those authorization or idempotency controls.
