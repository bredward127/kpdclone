# Manual accessibility and usability test script

## Setup

Use a keyboard-only pass at desktop width 1440×900 and mobile width 390×844. Repeat with NVDA + Chrome on Windows or VoiceOver + Safari on macOS/iOS. Disable the mouse for the keyboard pass and enable a 200% text zoom check.

## Critical flow

1. Start at Projects. Tab through the page title, create-project form, project links, and delete buttons. Confirm every control has a visible coral focus ring and a unique accessible name.
2. Open a project and verify the persistent stage navigation exposes the current project identity and the active stage in text, not color alone. On mobile, verify the two-column stage path remains reachable without horizontal scrolling.
3. In Page Studio, select a page plan and submit one generation. Confirm status changes are announced through the live region as queued, generating, needs review, failed, or cancelled. Confirm an error names the affected page number.
4. Trigger Stop queued work. Verify an alert dialog opens, focus lands on Keep it, Escape closes the dialog, and confirmation text explains that provider work may already be billed.
5. Review an asset with a blocking quality issue. Confirm Approve is disabled and the reason is available as visible text and an accessible label. Review an eligible asset and confirm the approval action is explicitly named.
6. In the reference library, start Delete. Confirm the dialog names the filename, offers a keyboard reachable cancellation path, and does not delete until the destructive action is confirmed.
7. In Cover Desk and Validation Desk, verify template, placement, rule severity, and region/page errors are understandable without color. Check that links and controls are reachable in a logical order on both widths.
8. In Export Center, verify the final-version checkbox, validation status, and package history are announced. Confirm download links are visibly named by artifact and remain reachable on mobile.
9. With a screen reader, confirm headings, form labels, dialog title/description, status live regions, image alternative text, and disabled-control explanations are announced in context.

## Evidence

Record browser/OS/screen reader, viewport, pass/fail per step, and the spoken or visible error text for each failure. Capture the desktop and mobile screenshots produced by the opt-in Playwright workflow under `test-results/`.

## Limitations

Automated axe checks cannot verify reading order quality, whether a spoken status message is understandable, or whether a confirmation warning is cognitively clear. VoiceOver behavior can vary between Safari releases, and browser zoom/reflow can differ from native mobile text scaling.
