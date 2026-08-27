# KDP Kids Book Studio: Production-Readiness Roadmap for Owners

**Audience:** The entrepreneur who owns the product and wants to test it from beginning to end.

**Current deployment:** Render service `kdp-studio` at `https://kdp-studio.onrender.com/`.

**Current status:** The application builds and runs on Render. The service has a paid Render instance, a 1 GB persistent disk mounted at `/var/data`, and the database/storage paths are configured inside that disk. The application shell loads publicly. The remaining work is primarily authentication, end-to-end creator testing, production content review, documentation/tutorials, and launch operations.

> Do not invite customers or publish a customer-facing launch until the production authentication path, complete creator workflow, deletion/recovery behavior, and final acceptance test have passed.

## 1. What is already complete

The delivered system includes the creator workflow structure, durable project storage, visual-reference handling, prompt versioning, server-side FAL queue integration, page review and approval concepts, interior and cover PDF services, KDP-oriented preflight checks, ZIP export packaging, provenance records, rate limits, private media delivery, webhook verification/idempotency, admin operations, retention cleanup, and automated tests.

The Render deployment has also been troubleshot successfully. The earlier `/var/data` permission error was caused by using a path that was not backed by a Render Persistent Disk. The disk is now mounted at `/var/data`, and the latest logs show the server listening on Render’s assigned port `10000`.

## 2. What is still required before production

| Priority | Work item | Why it matters | Current action |
|---|---|---|---|
| Blocking | Production authentication | Customers must have real accounts; development login must not be used publicly. | Choose and configure one approved authentication provider or trusted authentication proxy. |
| Blocking | Full creator acceptance test | Proves a real book can be created, validated, packaged, and downloaded. | Run the named 24-page fixture and one manually created test book. |
| Blocking | FAL production review | The model endpoint, pricing, input schema, and webhook settings must be reviewed. | Confirm the exact reviewed FAL model endpoint and webhook configuration. |
| Blocking | PDF and ZIP visual review | Automated tests cannot catch every visual defect. | Inspect representative interior pages, spreads, and all cover regions. |
| Blocking | Data deletion and recovery test | The owner must know how to remove projects and recover incomplete work safely. | Test deletion, one-job reconciliation, safe storage retry, and frozen-export regeneration. |
| High | Storage capacity and backup policy | A 1 GB disk is suitable for an initial test but may fill quickly with source images and PDFs. | Set a capacity alert and define when to expand the disk or move files to object storage. |
| High | Monitoring and alerts | A production owner needs to know when generation, webhooks, storage, or exports fail. | Review the admin operations dashboard daily during pilot use and establish an alerting method. |
| High | YouTube help videos | Customers will need visual instructions, not only written documentation. | Record short tutorials and host them privately or publicly on YouTube. |
| High | Contrast/readability pass | Deep navy surfaces and text must remain readable on desktop and mobile. | The shared navy color has been lightened; recheck Projects, Book Brief, Blueprint, and Page Studio on Render. |
| Medium | Domain and email identity | A branded domain builds trust and enables a professional login experience. | Buy a domain only after the current service is stable; then connect it in Render. |
| Medium | Manuals tab | A built-in help area can reduce support burden. | Treat this as a planned product enhancement, not a launch blocker unless customer testing shows it is essential. |

## 3. The first thing to fix: real production login

The current application’s visible sign-in button is connected to the temporary test-login route added for private owner testing. That route is protected by a server-side password, but it is not customer authentication.

For a private test only, add these Render environment variables:

```text
TEST_AUTH_ENABLED=true
TEST_AUTH_PASSWORD=your-private-test-password
```

Then redeploy and open:

`https://kdp-studio.onrender.com/auth/test-login`

After testing, remove both variables or set `TEST_AUTH_ENABLED=false` and redeploy.

For production, choose a real authentication provider. The selection must support secure redirect login, session management, password reset or account recovery, and a callback URL on the final domain. Record the provider name, dashboard URL, application ID, client ID, client secret, redirect URL, logout URL, cookie policy, and owner of the account in the deployment record. Never place a client secret, FAL key, or session secret in the browser bundle.

## 4. Render production setup checklist

In Render, open **Workspace → kdp-studio → Environment** and verify the following values without revealing secret values in screenshots:

```text
NODE_ENV=production
DATABASE_PATH=/var/data/app.db
PRIVATE_STORAGE_DIR=/var/data/private-storage
SESSION_SECRET=<long random secret>
FAL_KEY=<secret stored as a secret variable>
FAL_SMOKE_ENDPOINT=<administrator-reviewed FAL model ID>
FAL_WEBHOOK_ENABLED=true
FAL_WEBHOOK_URL=https://your-final-domain.example/api/fal/webhook
FAL_WEBHOOK_JWKS_URL=<current official FAL verification URL, if required>
```

The exact webhook variables depend on the current provider configuration and must be copied from the reviewed FAL documentation. Do not guess a webhook URL or verification key set.

In **Render → Disk**, verify that the disk is mounted at `/var/data`. Keep the database and private storage inside that mount. Do not use `/tmp` for production data.

In **Render → Settings**, confirm the build command is:

```text
pnpm install --frozen-lockfile; pnpm run build
```

Confirm the start command is:

```text
pnpm run start
```

Render supplies the `PORT` value. The server must listen on that port and be reachable from the public service URL.

## 5. FAL setup and smoke test

Create or use the owner’s FAL account at [fal.ai](https://fal.ai/). In the FAL model documentation, choose one image-generation endpoint whose current documentation has been reviewed. The smoke endpoint is the model’s exact **Model ID/Endpoint ID**, not the name of the FAL website and not the API key.

Store the endpoint ID in Render as the ordinary variable `FAL_SMOKE_ENDPOINT`. Store the credential only in the masked secret variable `FAL_KEY`.

Before any live smoke test, verify the following:

1. The selected endpoint supports the input schema used by the application.
2. The selected endpoint’s current pricing is acceptable for a one-image test.
3. The endpoint supports the aspect ratio and reference-image behavior you intend to test.
4. The FAL webhook documentation has been reviewed by an administrator.
5. The callback URL is publicly reachable over HTTPS.
6. The test uses exactly one disposable image and a disposable test project.
7. The result and provider request ID are visible only to authorized administrators.

The live smoke test must never run automatically in CI and must be followed by deletion of the disposable project and private files.

## 6. End-to-end owner test: create one book

Use a simple first book so visual defects are easy to see. Recommended test values are:

| Field | Example value |
|---|---|
| Project name | Garden Friends Pilot |
| Book type | Children’s coloring book |
| Audience | Ages 4–8 |
| Reading direction | Left to right |
| Trim | 8.5 × 11 inches |
| Bleed | No bleed for the first test, then repeat with bleed if supported |
| Interior length | 24 pages |
| Paper/ink | Black ink on white paper |
| Title | Garden Friends |
| Author | Your name or test imprint |
| Visual style | Friendly black line art, simple shapes, high contrast, uncluttered composition |
| Negative constraints | No readable text inside illustrations, no logos, no trademarks, no artist imitation, no watermark |
| Character bible | A smiling rabbit, a small turtle, and a round robin with consistent proportions |
| Seed | Use a fixed seed when the selected endpoint supports one |

Start at **Projects** and create the project. Then complete each stage in order:

1. **Book Brief:** enter the audience, book type, reading direction, trim, bleed, paper/ink choice, page count, title, author, imprint, visual-style anchors, character bible, and negative prompt.
2. **Visual references:** upload one PNG, JPEG, or WebP reference that you own or have permission to use. Check the rights declaration before using it for generation.
3. **Blueprint:** define the page sequence and the small scene direction for each page. Avoid generating every page at once; the intended workflow is deliberate page-by-page review.
4. **Page Studio:** select one page, inspect the inherited brief and composed prompt, select the reviewed FAL endpoint and aspect ratio, and submit one generation job.
5. **Review:** wait for completion, inspect pixel dimensions and effective DPI, then approve or reject with a reason. Regeneration must create a new variant and must not overwrite an approved result.
6. **Interior:** include only approved assets and intentional text/layout blocks. Confirm page order, mirrored gutters, margins, embedded fonts, blank-page behavior, and bleed sizing.
7. **Cover Desk:** import the current KDP calculator/template output. Confirm that its page count and paper settings match the finalized interior. Add separate approved front art, back art, and decorative assets. Add typography only through the deterministic export stage.
8. **Validation:** run preflight. Every blocking result must be resolved before export. Warnings still require human review.
9. **Exports:** confirm the project version is final and create the package. The ZIP should include the final interior PDF, final no-guides cover PDF, cover preview with guides, metadata JSON and CSV, validation report, provenance manifest, approved source images, and README.
10. **Download:** click the time-limited download link, save the ZIP to the computer, extract it, and open every expected file.

## 7. Visual inspection checklist

Open the interior PDF and inspect at least the first page, a representative left page, a representative right page, a text spread, a coloring page, the final interior page, and any intentionally blank page. Confirm that no image is stretched, clipped, blurry, outside the safe area, or placed on the wrong side of the spread.

Open the cover preview and final cover PDF. Inspect the back cover, spine, front cover, bleed edges, barcode exclusion area, spine safe zone, title, author, and absence of template instructions or guide marks. Confirm the final cover is one page and that the preview—not the guided file—is the file marked for visual reference only.

## 8. YouTube tutorial plan

A user manual has already been produced as written documentation, including the entrepreneur testing roadmap, release prerequisites, and operational recovery runbook. A built-in Manuals tab has not yet been implemented.

For customer support, record these short videos:

| Video | Length | Demonstrate |
|---|---:|---|
| Welcome and account setup | 3–5 min | Sign in, create a project, and explain private project storage. |
| Book Brief | 5–8 min | Explain every brief field and how the creative memory is reused. |
| Blueprint and Page Studio | 8–12 min | Plan one page, generate one image, review it, reject it, and regenerate a variant. |
| Uploading references safely | 4–6 min | Rights declaration, reference purpose, thumbnail, replacement, and deletion. |
| Cover Desk | 8–12 min | Import a current KDP template, place art, and review safe zones. |
| Validation and exports | 6–10 min | Resolve a blocking preflight issue and download the ZIP. |
| Recovery and deletion | 5–8 min | Explain failed jobs, missed webhooks, cleanup, and project deletion. |

Upload the videos to the owner’s YouTube channel. Decide whether each video is **Public**, **Unlisted**, or **Private**. Use unlisted videos for customer documentation when the videos should not appear in public search. Store the YouTube URL, title, version date, audience, and replacement procedure in the manuals record. Do not place secrets, private download links, customer artwork, or personal data in recordings.

## 9. Contrast and interface revision

The core interface uses a paper/ledger visual identity with navy navigation. The shared navy token has been lightened to improve white-text readability while preserving the Maker’s Ledger appearance. Recheck these pages at desktop and mobile widths:

- Projects
- Book Brief
- Blueprint
- Page Studio
- Cover Desk
- Validation
- Exports

Look specifically for navy text placed on navy or dark translucent backgrounds, muted labels that are too faint, disabled controls that are difficult to distinguish, and status indicators that rely on color alone. Capture before/after screenshots and keep the improved version only if keyboard focus, screen-reader labels, and status meaning remain clear.

## 10. Is this only for children’s books?

The product is currently **positioned and tested primarily for children’s books**, especially picture books and coloring books. The current acceptance fixture, visual language, examples, and KDP preflight workflow are child-focused.

It is not yet accurate to market the current release as a fully supported adult-book platform. Some generic book fields and PDF mechanisms can support other audiences, but adult publishing would require explicit product decisions and testing for:

- Adult audience and content categories.
- Mature-content policy and age gating.
- Cover and interior examples appropriate to adult readers.
- Content moderation and escalation for ambiguous sexual or violent content.
- New prompt guardrails and human-review rules.
- Metadata and category support for adult publishing.
- Additional privacy, legal, and customer-support procedures.

The existing policy correctly blocks child sexualization and other prohibited requests. That does not automatically mean the application is ready to create arbitrary adult content. Treat adult-book support as a separate product expansion after the children’s workflow is stable.

## 11. Domain purchase and connection

Buy a domain from a registrar such as Cloudflare Registrar, Namecheap, or GoDaddy. Choose a short brand name that is easy to say and spell. Before purchase, check trademark availability and social-media naming; do not assume that an available domain grants trademark rights.

After purchase:

1. Open Render → `kdp-studio` → Settings → Custom Domains.
2. Add the domain exactly as the registrar shows it.
3. Copy Render’s required DNS record.
4. Open the registrar’s DNS management page.
5. Add the CNAME or A/ALIAS record Render specifies. Do not invent a record type.
6. Wait for DNS propagation and Render certificate issuance.
7. Open the HTTPS domain in a private browser window.
8. Verify the root page, sign-in redirect, webhook URL, asset downloads, and logout flow.
9. Update the authentication provider redirect/callback URLs and `FAL_WEBHOOK_URL` to use the final domain.
10. Remove any old test or temporary URLs from customer-facing documentation.

## 12. Launch gate

The product is ready for a controlled pilot only after real authentication works, the owner can create and download a complete book, the live FAL smoke test passes, the 24-page fixture passes, all final PDFs have been visually reviewed, no secrets appear in any browser or downloadable artifact, deletion and recovery have been tested, and the owner has approved the cost and retention plan.

The launch should be a **private pilot**, not an unrestricted public launch. Invite a small number of trusted creators, monitor the operations dashboard, review failed jobs manually, and collect feedback before expanding access.

Do not publish automatically from this application. KDP Print Previewer and KDP’s own review remain the final authority for upload readiness and acceptance.

## 13. Immediate next actions

The shortest path from today to a usable private pilot is:

1. Keep the Render disk and environment settings exactly as they are.
2. Deploy the latest GitHub commit containing the bounded test-login route.
3. Add `TEST_AUTH_ENABLED=true` and a privately chosen `TEST_AUTH_PASSWORD` in Render.
4. Use the test login to complete the 24-page book workflow.
5. Confirm the FAL endpoint is the exact reviewed model ID and run one owner-authorized smoke image.
6. Fix any workflow or contrast problems discovered during the test.
7. Configure real production authentication before inviting anyone else.
8. Record the YouTube tutorials and decide whether to build the Manuals tab.
9. Buy and connect the domain.
10. Run the final release checklist and begin a controlled pilot.
