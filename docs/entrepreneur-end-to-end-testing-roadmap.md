# KDP Kids Book Studio for Beginners
## A click-by-click guide to launching, testing, and downloading your first book

**Audience:** You have purchased or are evaluating KDP Kids Book Studio, you are not a software engineer, and you want to create one real book from beginning to end.

**What this guide does:** It tells you which services to use, where to create accounts, what to click, what to type, how to test the book, and what a successful result looks like.

**Last reviewed:** August 27, 2026

> **The short answer:** You can use Vercel for websites, but the current KDP Kids Book Studio is not a good direct fit for Vercel as a complete application. The current product uses an Express server, SQLite database files, private local storage, server-side image processing, PDFs, ZIP creation, and asynchronous provider callbacks. Vercel’s own documentation says SQLite cannot be used for permanent storage in its serverless environment because the filesystem is ephemeral [1]. For the current product, I recommend **Render Web Service + Render Persistent Disk** for your first hosted pilot. Vercel can remain a separate marketing-site host later, but it should not be the only host for this current codebase.

## Part 1: Understand what you are buying

KDP Kids Book Studio is not a button that automatically publishes a book to Amazon. It is a private production workspace. You use it to organize a book, create original artwork, review every page, assemble print files, validate them against a versioned KDP-oriented ruleset, and download a package for your own manual review and upload.

The full customer journey is:

| Step | Plain-English meaning | What you should see |
|---:|---|---|
| 1 | Sign in as the creator | A private studio, not a public sample page |
| 2 | Create a project | Your book remains after refresh or restart |
| 3 | Write the brief | The app remembers your title, audience, characters, style, and print choices |
| 4 | Add a visual reference | A private thumbnail and rights confirmation |
| 5 | Create a page plan | An ordered list of pages |
| 6 | Create a prompt version | A saved, frozen record of what will be sent for generation |
| 7 | Generate one page | A secure server-side FAL request and a visible job status |
| 8 | Review and approve | A human decides whether the image may be used |
| 9 | Assemble the interior | A print-oriented interior PDF and layout manifest |
| 10 | Build the cover | A template-based single-page full-wrap PDF |
| 11 | Run preflight | Errors and warnings with exact page or cover locations |
| 12 | Create the package | A private ZIP that you download to your computer |

The app intentionally does **not** generate an entire unreviewed book in one uncontrolled request. You approve the pages that enter the final book.

## Part 2: The service recommendation

### Recommended setup for your first hosted pilot: Render

Use **Render** for the complete current application:

1. **Render Web Service:** runs the Node/Express application and serves the React website.
2. **Render Persistent Disk:** stores the SQLite database and private images/PDFs/ZIPs between restarts and deployments. Render documents that ordinary service filesystems are ephemeral and that persistent disks preserve files across deploys and restarts [2]. A persistent disk is a paid-service feature, so check the current Render price before subscribing.
3. **GitHub:** stores the application source code and automatically supplies new deployments when you push updates.
4. **FAL:** generates the approved page artwork. Its secret is stored only in Render’s server-side environment settings.
5. **Your domain provider:** optional for the first test, recommended before inviting real customers.

Render also documents background workers for long-running media and third-party API tasks [3]. The current code already uses an asynchronous FAL queue/callback pattern. For a first pilot, begin with one Render Web Service and the existing application behavior. Before scaling to many customers or multiple instances, have the application upgraded to use a managed database/object-storage service and a dedicated worker queue.

### Why I do not recommend “Vercel only” for the current version

Vercel is excellent for frontend websites and serverless applications, but the current repository writes a SQLite file and private files to the local filesystem. Vercel’s official guidance says SQLite cannot be used for permanent storage in Vercel’s serverless environment [1]. A Vercel-only deployment would require a separate database, separate private object storage, serverless-compatible image/PDF handling, webhook changes, and likely an application architecture change.

You can still use Vercel for a future public landing page. If you do that, the public landing page and the KDP Studio application would be two separate deployments. Do not point the current full application at Vercel until its database, storage, long-running work, and callback architecture have been migrated and tested.

### Services you should not buy yet

Do not purchase extra services merely because they appear in a generic software checklist. For the first test, you do not need a separate analytics platform, a separate queue product, a separate PDF service, or a separate AI key-management product. Adding them would increase setup complexity without proving the book workflow.

You do need to confirm the application’s authentication integration before inviting a real customer. The current repository has protected server procedures and an authentication boundary, but the exact hosted login/proxy configuration must be confirmed in your deployed environment. If the deployed site shows “unauthorized” instead of a sign-in experience, stop there and have the authentication integration configured before testing customer data.

## Part 3: Accounts to create and where to go

Open these sites in separate browser tabs:

| Service | Go here | Why you need it | Who should own it |
|---|---|---|---|
| GitHub | [github.com](https://github.com/) | Source code and deployment connection | Your business or company account |
| Render | [dashboard.render.com](https://dashboard.render.com/) | Hosts the current application and persistent disk | Your business account |
| FAL | [fal.ai](https://fal.ai/) | Provides asynchronous image generation | Your business account |
| KDP | [kdp.amazon.com](https://kdp.amazon.com/) | Official cover templates, publishing metadata, Print Previewer, and eventual upload | Your publishing business account |
| Domain provider | The registrar where you buy your domain | Optional branded address such as `studio.yourcompany.com` | Your business account |

Keep the email address, recovery email, billing ownership, and two-factor authentication under your business control. Do not use an employee’s personal account as the only owner account.

## Part 4: Before you deploy, collect these things

Prepare the following in a folder or password manager. Do not put secrets in a normal notes document.

| Item | Example | Where to keep it |
|---|---|---|
| GitHub repository access | `bredward127/kpdclone` | GitHub account |
| Render account | Business owner email | Render account |
| FAL account | Business owner email | FAL account |
| FAL server credential | Secret value from FAL | Render secret environment variable only |
| Reviewed FAL model endpoint | Exact stable endpoint identifier | Business release record and Render variable |
| Render disk mount plan | `/var/data` | Render service configuration |
| Production domain | `studio.example.com` | Domain registrar and Render |
| KDP cover template | Downloaded after final page count is known | Private application upload and business records |
| Permitted font files | Actual licensed font files | Private business records and protected app workflow |
| Test book concept | Garden Friends coloring book | Your brief and test record |

## Part 5: Deploy the current application to Render

This section assumes you are starting with the repository already available on GitHub.

### 5.1 Sign up for Render

Go to [dashboard.render.com](https://dashboard.render.com/). Choose **Sign up** or **Get Started**, and use the business email that should own the deployment. If Render offers “Continue with GitHub,” use the GitHub account that can read `bredward127/kpdclone`. Approve only the repository access that you intend to use.

After signing in, you should see the Render dashboard. Do not create a Static Site. The current application needs a running Node server, private storage, and database persistence, so you need a **Web Service**.

### 5.2 Create the Web Service

In Render:

1. Click **New**.
2. Choose **Web Service**.
3. Choose **Build and deploy from a Git repository**.
4. Connect GitHub if Render asks for permission.
5. Select `bredward127/kpdclone`.
6. Give the service a business name such as `kdp-kids-book-studio`.
7. Choose the region closest to your expected customers and FAL traffic.
8. Choose a paid instance plan that supports a persistent disk. Render’s available plans and prices can change; select the smallest plan that can run the application and check the current billing page before confirming.
9. Set the build command to:

```text
pnpm install --frozen-lockfile && pnpm build
```

10. Set the start command to:

```text
pnpm start
```

11. Do not click **Create Web Service** yet if you have not prepared the environment variables below. You can create it first and add variables immediately afterward, but the first deployment will not become usable until they are present.

### 5.3 Add the persistent disk

In the Render service creation form, open **Advanced** and find the disk option. If the disk is not available during creation, create the service and then open its **Disks** page.

Add a persistent disk with:

| Setting | Value |
|---|---|
| Mount path | `/var/data` |
| Size | Start with the smallest size that comfortably holds your test files; increase later if needed |
| Purpose | SQLite database and private application storage |

Render states that only files below the selected mount path are preserved [2]. That is why the application variables below must point into `/var/data`. Do not store customer files in the source-code folder or a public static folder.

### 5.4 Add environment variables in Render

In the Render service, open **Environment** or **Environment Variables**, then click **Add Environment Variable**. Add these one by one. Click **Save Changes** when finished.

#### Required pilot variables

| Name | Value for your Render service | Secret? |
|---|---|---:|
| `NODE_ENV` | `production` | No |
| `PORT` | Leave blank if Render supplies it automatically; otherwise use the port required by the service | No |
| `DATABASE_PATH` | `/var/data/app.db` | No |
| `PRIVATE_STORAGE_DIR` | `/var/data/private-storage` | No |
| `SESSION_SECRET` | Generate a long random value in a password manager | **Yes** |
| `FAL_KEY` | Your FAL server credential | **Yes** |
| `FAL_SMOKE_ENDPOINT` | The exact administrator-reviewed inexpensive FAL image endpoint identifier | No |
| `FAL_ACTIVE_ENDPOINTS` | The exact reviewed FAL image endpoint(s) Page Studio may use, comma-separated | No |
| `FAL_TEXT_ENDPOINT` | `openrouter/router/openai/v1/chat/completions` after reviewing the current FAL page | No |
| `FAL_TEXT_MODEL` | A real model identifier copied from that FAL endpoint’s model documentation, in `vendor/model` form — for example `openai/gpt-4o`. Enter the identifier itself, not this description. | No |
| `FAL_WEBHOOK_ENABLED` | `false` for the first local-style generation check; `true` only after the HTTPS callback is ready | No |
| `FAL_TEXT_TIMEOUT_MS` | Optional. How long to wait for the drafting model, in milliseconds. Defaults to `120000` (two minutes); a real 24-page draft takes roughly 15-30 seconds. | No |
| `FAL_SYNC_BASE_URL` | Optional. Host for FAL endpoints that answer synchronously. Defaults to `https://fal.run` and should not normally be set. | No |

#### FAL story-drafting setup

The current Blueprint AI drafting flow uses FAL for story summaries, page text, and scene directions. The supplied FAL reference identifies the OpenAI-compatible endpoint as `openrouter/router/openai/v1/chat/completions` and recommends the `@fal-ai/client` queue pattern. Set `FAL_TEXT_ENDPOINT` to that endpoint and set `FAL_TEXT_MODEL` to a currently supported model identifier selected from the endpoint’s live documentation. Do not use the older `fal-ai/any-llm` endpoint; FAL currently marks it deprecated. The application uses the existing server-only `FAL_KEY` for both image and text requests. It never sends that key to the browser.

Story drafting calls the OpenAI-compatible chat-completions endpoint **synchronously**: one POST to `https://fal.run/<FAL_TEXT_ENDPOINT>` returns the finished completion. That endpoint is not a queue app and exposes no `/requests/{id}/status` sub-path, so it must not be driven with the queue submit-then-poll pattern -- doing so returns `405 Method Not Allowed` after the model has already run and been billed.

These two variables must contain identifiers, not descriptions of identifiers. Pasting the wording from the table above into the value produces a FAL `400 ... is not a valid model ID` at drafting time. The server now refuses obvious placeholder text before calling FAL and names the variable at fault, and any provider rejection is reported with its HTTP status and FAL's own message.

#### Add these when production callbacks are ready

| Name | What to enter |
|---|---|
| `FAL_WEBHOOK_URL` | Your public HTTPS callback URL, for example `https://studio.example.com/webhooks/fal` |
| `FAL_WEBHOOK_JWKS_URL` | The current provider-documented verification URL if your selected FAL verification method uses JWKS |
| `TRUSTED_AUTH_PROXY` | Only the exact value required by your approved authentication proxy configuration |

#### Do not set these for normal production use

| Variable | Why it exists |
|---|---|
| `ENABLE_DEV_AUTH` | Local development/testing only; never enable for real customers |
| `LIVE_FAL_SMOKE` | One-time owner-gated test only |
| `CONFIRM_LIVE_FAL` | Must be the exact owner confirmation phrase for that test |
| `FAL_SMOKE_ADMIN` | Only controls whether an authorized administrator may see a provider request ID |
| `RUN_BROWSER_E2E` | Test environment only |
| `E2E_BASE_URL` | Test environment only |
| `CI` | Normally supplied by your CI system; live smoke must stay disabled in CI |

The repository also recognizes `VISUAL_REFERENCE_JSON_LIMIT` as an optional bounded upload/request-size setting. Leave the application default in place unless your operator or developer has chosen a specific lower limit.

**Never create a variable beginning with `VITE_` for `FAL_KEY`.** Client-exposed variables can be sent to browsers. The FAL key must remain a server-only Render secret.

### 5.5 Deploy and open the site

Click **Create Web Service** or **Deploy**. Render will clone the GitHub repository, install dependencies, build the client and server, and start the service. Watch the **Events** or **Logs** panel.

A successful deployment ends with a running service and a public Render URL similar to `https://kdp-kids-book-studio.onrender.com`. Click **Open**.

If the deployment fails, copy the error text into your support/development record without including environment-variable values. Common causes are a missing build command, a missing secret, an invalid start command, or a storage path that is not inside `/var/data`.

## Part 6: Authentication before you create a customer book

Open the deployed URL in a private/incognito browser window. You need to see a sign-in flow or a controlled local/test authentication flow. Then sign in as your test creator.

If you see **Opening your private studio**, wait for the authentication request. If you see **Authentication service unavailable**, the auth integration or proxy is not configured. If you see **Unauthorized**, do not create a project yet; the deployed service does not know who you are.

For a pilot with real customers, require a proper production authentication configuration and test these cases before customer use:

1. Creator A can see Creator A’s project.
2. Creator B cannot see, edit, download, or delete Creator A’s project.
3. An unauthenticated browser cannot open a private project URL.
4. An administrator can access administrator-only operations, while a normal creator cannot.
5. Logging out removes access to protected pages.

Do not use `ENABLE_DEV_AUTH` as the customer login system.

## Part 7: Create your first book in the browser

### 7.1 Create the project

1. Go to **Projects**.
2. Click **New Project**.
3. Enter a name, such as `Garden Friends — 24-page Coloring Book`.
4. Choose a children’s activity or coloring-book type.
5. Choose an 8.5 × 11 inch trim size for the first test.
6. Choose left-to-right reading direction.
7. Choose a target page count of 24.
8. Choose the interior paper/ink and bleed settings you intend to test.
9. Click **Create Project**.
10. Refresh the page. The project should still be listed.

If the project disappears after refresh, stop. Do not proceed: durable project persistence is not working.

### 7.2 Complete the Book Brief

Open **Book Brief** and enter values like these:

| Field | Example value |
|---|---|
| Working title | `Garden Friends` |
| Subtitle | `A Calm Coloring Adventure` |
| Intended audience | `Children ages 4–7; large open coloring areas and simple recognizable objects` |
| Visual-style anchors | `Original black line art, smooth thick outlines, friendly rounded forms, sparse detail, white background` |
| Character bible | `Milo is a small dog with one floppy ear and a bandana. Pip is a round bird with three feather marks. Keep their proportions and markings consistent.` |
| Setting anchors | `Community garden, raised beds, watering can, sunflowers, simple fence` |
| Negative prompt | `No readable text, no logos, no brands, no copyrighted characters, no trademarked costumes, no photorealism, no gradients, no dense shading, no living-artist style imitation` |

Save the brief. Leave the page, return to the project, and confirm the information remains. This is the “remembered creative memory” that later prompts inherit.

### 7.3 Create the page plan

Open **Blueprint**. Create an ordered 24-page plan. For the first test, use this structure:

| Pages | Plan |
|---:|---|
| 1 | Title/copyright page |
| 2 | How to use this coloring book |
| 3–22 | Twenty original coloring/activity pages |
| 23 | Completion or encouragement page |
| 24 | Intentional end matter or blank page if appropriate |

For each artwork page, write one clear scene direction. Example: `Milo waters a row of sunflowers while Pip sits on the fence.` Another example: `Pip finds a large garden snail beside a leaf.`

Do not type a whole novel into every page direction. The project brief supplies the shared memory; the page direction supplies the unique action.

### 7.4 Upload one visual reference

Prepare a character sheet or sketch that you own or have permission to use. Supported formats are PNG, JPEG, and WebP.

In the visual-reference area:

1. Click **Upload Reference**.
2. Choose the file from your computer.
3. Select a type such as **Character sheet** or **Sketch reference**.
4. Confirm the statement: **I own this reference or have permission to use it.**
5. Upload it.
6. Confirm that a private thumbnail appears.

Do not upload a celebrity image, a copyrighted character sheet, another artist’s work without permission, or a file you found online without rights documentation.

### 7.5 Create a page prompt

Open **Page Studio** and select one page, such as page 3.

Choose:

- The approved model configuration shown by the application.
- An aspect ratio that matches your intended page placement.
- A seed only if you want one and the selected endpoint supports it.
- The approved visual reference.

Click **Compose Prompt**. Read the complete prompt. It should include the book identity, audience, character continuity, page scene, visual style, composition, print-safe requirements, negative constraints, and model parameters.

Review any lint warnings. Do not ignore a warning about copyright, trademarks, child safety, artist imitation, missing subject, vague style, unsupported references, or conflicting print constraints.

Save and freeze/approve the prompt version. Record its prompt-version ID in your test notes.

### 7.6 Generate one page

Click **Generate** once. Wait for the job status to update. You should see a progression such as **Queued**, **Generating**, and **Needs Review**.

The browser should not contain your FAL key, and the browser should not call the FAL API directly. The server sends the request.

When the image arrives, check:

- It is the correct page.
- It follows the character bible.
- It has no unwanted text, logo, brand, or copied character.
- Its pixels are sufficient for the intended print size.
- It is not blank, corrupted, stretched, or excessively detailed.
- The prompt version, endpoint, seed, and reference list are correct.

Click **Approve** only after you have looked at the image. If it is wrong, click **Reject** and enter a reason, or regenerate a variation. An approved image must never be silently overwritten.

### 7.7 Finish the approved page set

For a true end-to-end test, approve the page assets that will be placed into the interior. You may use deterministic fixture assets for the remaining pages in a test environment, but you should not call the package final if the remaining production pages have not been reviewed.

The system permits only small explicit queue actions such as **Generate next 2** or **Generate next 3**. Confirm the displayed pages before submitting.

## Part 8: Build the interior PDF

Open the interior export action. Confirm:

- The page order is correct.
- Only approved assets are selected.
- The trim size and bleed match the project.
- The reading direction is correct.
- The gutter and safe margins are appropriate.
- Permitted fonts are selected.
- Text blocks are intentional.
- The page count is exactly what you planned.

Create the interior export. It should produce a final interior PDF, a layout manifest, and a preflight report. It may also produce a preview PDF labeled as non-upload output.

Download or open the interior PDF and inspect at least:

1. The first page.
2. One left-hand page.
3. One right-hand page.
4. One page near the gutter.
5. One page with text.
6. One full-bleed page, if your book uses bleed.
7. The final page.

Confirm that artwork is not cut off unexpectedly, text is inside safe margins, page numbers/order are correct, and no unapproved image appears.

## Part 9: Build the cover from the official KDP template

Open **Cover Desk**. Enter or confirm:

| Cover input | What you enter |
|---|---|
| Binding | Paperback |
| Trim size | Same as final interior |
| Final interior page count | Actual finalized interior count |
| Interior paper/ink | Same as final interior |
| Reading direction | Left to right or right to left |
| Title | Final cover title |
| Subtitle | Optional final subtitle |
| Author | Final author name |
| Imprint | Optional imprint |
| Back-cover copy | Final copy, if used |
| Barcode decision | Whether you supply one or let KDP add one |
| Spine text | Only when the current rule and safe zone permit it |
| Front art | Approved focal artwork with no readable cover text |
| Back art | Optional approved art/background |
| Decorative art | Optional approved elements |

Now go to the official [KDP paperback cover help page](https://kdp.amazon.com/help/topic/G201953020) and retrieve the current calculator/template output after the page count and print settings are final. The project documentation records the official KDP sources reviewed on August 27, 2026; recheck them before every real book because KDP can change its requirements.

Import the calculator/template output into Cover Desk. Confirm that the imported page dimensions and safe zones match your final interior. If the page count changes, do not reuse the old cover template. Import a new one.

Create the final cover and the labeled preview cover. Inspect:

- Back cover placement.
- Spine width and text eligibility.
- Front cover placement.
- Barcode exclusion area.
- Bleed extension.
- Safe zones.
- Absence of guides, crop marks, color bars, or template instructions in the final PDF.
- No unintended white edge around full-bleed artwork.

## Part 10: Run preflight and create the ZIP

Open **Validation** and run the KDP-oriented preflight. Read every blocking issue. The report should identify the page or cover region, expected value, measured value, source asset, and suggested remedy.

Fix all blocking issues before exporting. A successful status means:

> **Ready for manual KDP upload review.**

It does not mean KDP has accepted the book.

Open **Exports**. Enter or select the validation run, interior export, cover export, frozen project version, listing metadata, approved source image IDs, title, author, description, keywords, categories, language, and subtitle. Confirm the checkbox stating that the selected project version is final.

Click **Create private export package**. Wait for completion. Click **Re-download ZIP**.

Save the ZIP to your computer, usually in your browser’s **Downloads** folder. Open your computer’s Downloads folder, double-click the ZIP, and extract it.

The expected package includes:

```text
upload-ready/interior.pdf
upload-ready/cover-full-wrap.pdf
preview-reference/cover-preview-with-guides.pdf
listing/listing-metadata.json
listing/listing-metadata.csv
validation/validation-report.pdf
provenance/provenance-manifest.json
approved-source-images/...
README.md
export-manifest.json
```

Open the two upload-ready PDFs and the preview PDF from the extracted folder. Keep the README with them. The preview is for your inspection and should not be uploaded as the final interior or cover.

## Part 11: What counts as a successful test

Your test is successful when you can complete all of the following from a normal browser session:

| Check | Pass condition |
|---|---|
| Sign-in | A creator can enter a private studio |
| Durable project | The project survives refresh and server restart |
| Brief memory | The saved brief and character bible appear in later prompt composition |
| Reference security | An uploaded reference is private and rights-attested |
| Prompt version | A prompt is saved, frozen, hashed, and traceable |
| Secure generation | The browser does not receive or call FAL with the secret |
| Human approval | An asset must be reviewed before export |
| Interior | The PDF has the intended page count, ordering, margins, fonts, and approved assets |
| Cover | The PDF is one-page full-wrap and based on the imported official template |
| Preflight | There are no blocking findings |
| Package | The ZIP contains the expected artifacts and opens on your computer |
| Ownership | Only the project owner can access the download |
| Secret scan | No key appears in browser traffic, source files, logs, screenshots, database rows, PDFs, manifests, or ZIP files |

## Part 12: The owner-gated FAL smoke test

Run the smoke test only after an authorized owner explicitly confirms it. In Render, temporarily add the required owner-gated variables:

```text
LIVE_FAL_SMOKE=1
CONFIRM_LIVE_FAL=GENERATE_ONE_TEST_IMAGE
FAL_SMOKE_ADMIN=0
```

The server must also have `FAL_KEY` and `FAL_SMOKE_ENDPOINT`. Run the command from a secure terminal or approved deployment shell:

```text
pnpm test:live-fal
```

This test is intentionally not a button in the customer UI. It submits exactly one inexpensive disposable image, does not retry after timeout, and deletes the temporary result. Remove the owner-gated variables after the test. Do not run it in CI.

If the application says `FAL_SMOKE_ENDPOINT is not configured`, stop and obtain the exact current endpoint identifier from the administrator-reviewed FAL model documentation. Never guess it.

## Part 13: Browser acceptance testing

The browser acceptance test is a separate technical check. It needs a test server, a test login, and the Playwright browser installed. It is not required for you to create a book manually in the browser, but it is useful before inviting customers.

The technical operator should install the browser, configure `RUN_BROWSER_E2E=1` and `E2E_BASE_URL`, and run:

```text
pnpm exec playwright install chromium
pnpm test:e2e
```

Do not point it at a real customer account. If the browser is not installed, the test cannot launch; that is a test-environment problem, not a customer-book problem.

## Part 14: Troubleshooting in plain English

| What you see | What it means | What to do |
|---|---|---|
| The site will not open | Deployment failed or service is stopped | In Render, open **Events** and **Logs**. Look for the first error. |
| The site opens but says Unauthorized | Authentication is not connected | Stop; configure the approved production login/proxy integration. |
| Project disappears after refresh | Database path is not persistent or migration failed | Check `DATABASE_PATH=/var/data/app.db` and the Render disk mount. |
| Upload fails | File is wrong type, too large, corrupt, or lacks rights confirmation | Use PNG/JPEG/WebP within limits and confirm permission. |
| Generation button does nothing | Prompt is not approved/frozen, model is inactive, or policy review blocks it | Read the displayed message and correct the saved data. |
| Generation remains queued | Callback may be missed or provider is still working | An administrator should reconcile one selected job, not retry all jobs. |
| Interior export is blocked | An asset is unapproved or a quality rule failed | Review the named page and approve a corrected asset. |
| Cover is wrong after page-count change | The imported KDP template is stale | Retrieve and import a new official template. |
| Preflight is red | At least one blocking rule failed | Fix the exact page/region named in the report and rerun it. |
| ZIP link expired | The private link reached its expiry | Reopen Exports as the owner and request a valid re-download if retained. |
| FAL smoke test refuses to run | An owner gate or endpoint is missing | Confirm the exact variables and reviewed endpoint; do not weaken the gate. |
| Render service restarts and files vanish | The disk is missing or paths point outside the disk | Check the persistent disk mount and both path variables. |

## Part 15: Who should do what

As the business owner, you should supply the book concept, rights confirmations, creative brief, final metadata, cover inputs, KDP account, and final human approval. You should own the GitHub, Render, FAL, domain, and KDP accounts.

A technical operator or developer should configure the Render service, persistent disk, authentication integration, HTTPS callback, server-only secrets, deployment variables, backup policy, and browser acceptance environment. They should never ask you to paste `FAL_KEY` into the browser or into a normal document.

A book-production reviewer should inspect every generated page, the interior PDF, the cover PDF, the preflight report, and the extracted ZIP. You can perform this role yourself for the first book.

## Part 16: Your first-week checklist

On day one, create the business-owned GitHub, Render, FAL, and KDP accounts. On day two, deploy the Render service with the persistent disk and confirm the site opens. On day three, confirm authentication and create the 24-page test project. On day four, complete the brief, upload one rights-attested reference, generate and approve one page, and verify the remembered prompt context. On day five, finish the approved fixture set and create the interior. On day six, retrieve the official KDP template, create the cover, run preflight, and correct blocking errors. On day seven, create the ZIP, download it to your computer, extract it, inspect the PDFs, and record the artifact hashes and test result.

Do not invite paying customers until you can complete the workflow with a clean test account, verify owner-only access, confirm private storage, and explain the recovery procedure for a failed generation, stale cover template, failed preflight, or expired download.

## References

[1]: https://vercel.com/kb/guide/is-sqlite-supported-in-vercel "Vercel: Is SQLite supported in Vercel? Retrieved August 27, 2026."
[2]: https://render.com/docs/disks "Render: Persistent Disks. Retrieved August 27, 2026."
[3]: https://render.com/docs/background-workers "Render: Background Workers. Retrieved August 27, 2026."
[4]: https://kdp.amazon.com/help/topic/G201953020 "Amazon KDP: Paperback cover requirements. Project source reviewed August 27, 2026."
[5]: https://kdp.amazon.com/help/topic/G201857950 "Amazon KDP: Cover design requirements. Project source reviewed August 27, 2026."
[6]: https://kdp.amazon.com/help/topic/G5HDYGP4BXLX4RUW "Amazon KDP: Barcode requirements. Project source reviewed August 27, 2026."
[7]: https://kdp.amazon.com/help/topic/G200672390 "Amazon KDP: Metadata guidance. Project source reviewed August 27, 2026."
