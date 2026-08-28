# Render troubleshooting findings

Reviewed: 2026-08-27

The Render service is `kdp-studio` at `https://kdp-studio.onrender.com`.

The first failed starts were caused by the production startup guard reporting that `FAL_KEY` was absent. Later starts show that `FAL_KEY` was added successfully and the process reached `KDP Kids Book Studio listening on :10000`; Render reported the service live.

A subsequent failed start was caused by `EACCES: permission denied, mkdir '/var/data'` from `createDatabase`. The application is trying to create the literal `/var/data` directory, but the service does not currently have a writable persistent disk mounted at that path, or the configured path is not appropriate for the service. The fix must be made in Render’s Disk and Environment settings; do not make `/var/data` public or store secrets there.

The user’s screenshot showing `{\"message\":\"Not found\"}` is consistent with reaching the server while the application is not serving the React index at the requested root path, or with opening an API/backend path rather than the public app route. This must be rechecked after the service remains healthy and the disk error is resolved.

The healthy log showed the service listening on Render’s supplied port `10000`, so the start command is currently reaching the server process. The relevant next checks are Render Environment, Render Disk, and the service’s public URL after a successful restart.

## Additional confirmed dashboard findings

The Render service is on the **Free** compute plan. Opening the Disk page shows an “Enable Disk Access” upgrade modal stating that disks are not supported on Free compute plans and that the Starter plan includes Persistent Disks. Therefore, `/var/data` cannot currently be a writable persistent mount for this service.

The Environment page visibly contains `DATABASE_PATH`, `FAL_KEY`, `FAL_WEBHOOK_ENABLED`, `PRIVATE_STORAGE_DIR`, and `SESSION_SECRET`. Secret values were not opened or copied. The service URL shown is `https://kdp-studio.onrender.com`.

## Public URL and authentication findings

The public root URL `https://kdp-studio.onrender.com/` now serves the KDP Kids Book Studio React shell and displays “Sign in to enter the workshop.” The earlier JSON 404 was not the root application page; it occurred at `/auth/dev-login`.

The sign-in link currently points to `/auth/dev-login`, but that route returns `{"message":"Not found"}` in the production deployment because development authentication is not enabled. Enabling development authentication in production is not a safe customer-login solution. A real production authentication integration or approved auth proxy must be configured before customer use.

Render remains on the Free plan, which does not support persistent disks. The `/var/data` failure is therefore expected until the service is upgraded and a disk is mounted, or the application is migrated to external managed database/object storage.

## Upgrade verification

After the user reported upgrading, the authenticated Render dashboard still displayed the service as **Free** and the Disk page still showed “Enable Disk Access” with Persistent Disks unavailable on Free compute plans. This indicates either the upgrade was applied to a different service/workspace, the current page has not refreshed, or the upgrade has not completed. The service needs a dashboard refresh and confirmation that the `kdp-studio` service itself is on a disk-enabled plan before changing paths or restarting.

## Paid plan confirmation

The Render Compute page now shows the service on `0.5c-512mb` ($7/month), so the plan upgrade has taken effect. The service also exposes One-off Jobs, consistent with the paid plan. The next required check is the Disk page, followed by attaching a disk if none is present.

## Mixed-instance deployment state

The latest Render logs show two overlapping instance states. One instance (`85p4n`) continues to crash on `EACCES: permission denied, mkdir '/var/data'`. Another instance (`nknpp`) reaches `KDP Kids Book Studio listening on :10000` and Render reports the service live, but the log then shows `ELIFECYCLE Command failed`. This mixed state can explain intermittent 502 responses while Render restarts failed instances.

The service is now on the paid `0.5c-512mb` plan, but a disk mount is not yet confirmed. The next action is to inspect the Disk page and ensure a disk is mounted at `/var/data`; merely setting `DATABASE_PATH` and `PRIVATE_STORAGE_DIR` is insufficient.

## Disk attached and service healthy

The Render service now shows the paid `0.5c-512mb` plan and the Disk page confirms a **1 GB persistent disk** mounted at `/var/data`. The latest deployment logs show a successful build, the server listening on `:10000`, and Render marking the service live. The public root now returns the KDP Kids Book Studio app shell and redirects to `/projects`, where it displays the private-studio sign-in screen. The prior 502 was caused by the service restart/mixed unhealthy state while the disk was unavailable; after the disk attachment and successful restart, the root is reachable.
