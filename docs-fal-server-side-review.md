# FAL official documentation review

Reviewed 2026-08-27: [FAL Server-side Integration](https://fal.ai/docs/documentation/model-apis/inference/server-side).

Key implementation constraints used in this change:

- FAL states that exposing API keys in client-side code is not safe and recommends a server-side API/proxy.
- The server-side proxy formula resolves the credential from the `FAL_KEY` environment variable and sends it as an authorization credential to FAL.
- The client-facing application must not receive the raw credential; this project therefore exposes only masked connection status through an administrator-only procedure.

The model registry will contain only endpoint identifiers whose official current documentation has been reviewed and recorded. No provider behavior is inferred from memory.
