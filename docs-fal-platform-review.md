# FAL platform API review

Reviewed 2026-08-27: [FAL Model Search](https://fal.ai/docs/platform-apis/v1/models).

The official page documents the model search endpoint as an authenticated-capable platform API. It supports listing model endpoints and returning model metadata such as endpoint identifiers, display names, status, model URLs, and update timestamps. The integration uses the documented `GET https://api.fal.ai/v1/models` route with a bounded `limit=1` request as the administrator-only connection check. The response is reduced to a masked status and count; no provider response or credential is returned to the caller.
