# FAL queue and webhook review

Reviewed 2026-08-27 from official documentation:

- Queue: https://fal.ai/docs/documentation/model-apis/inference/queue
- Webhooks: https://fal.ai/docs/documentation/model-apis/inference/webhooks

The queue API is the recommended asynchronous path. Submission returns a provider `request_id` immediately, along with status, response, and cancel URLs. Queue statuses are `IN_QUEUE`, `IN_PROGRESS`, and `COMPLETED`; a completed request's result is model-specific and must be retrieved or received through the webhook. Cancellation can return `202 CANCELLATION_REQUESTED`, `400 ALREADY_COMPLETED`, or `404 NOT_FOUND`.

Webhook payloads contain `request_id`, `gateway_request_id`, `status` (`OK` or `ERROR`), and a result `payload`. FAL recommends returning a 2xx quickly and processing deliveries idempotently by `request_id`; failed deliveries may be retried. Result media URLs are publicly accessible and expire, so the application must download approved results into private storage before treating them as project assets.

The current official webhook signature mechanism is public-key verification, not a shared HMAC secret. Required headers are `X-Fal-Webhook-Request-Id`, `X-Fal-Webhook-User-Id`, `X-Fal-Webhook-Timestamp`, and `X-Fal-Webhook-Signature`. The timestamp must be within ±300 seconds. The signed message is the request ID, user ID, timestamp, and SHA-256 hash of the raw request body joined with newlines. The signature is hexadecimal and is verified with ED25519 public keys from the cacheable JWKS endpoint `https://rest.fal.ai/.well-known/jwks.json`; keys should not be cached longer than 24 hours.

Production webhook traffic will remain disabled unless JWKS verification is configured and enabled. The implementation will support an explicit verification mode and reject missing, stale, malformed, or unverifiable callbacks.

The official JavaScript queue reference (`https://fal.ai/docs/api-reference/client-libraries/javascript/queue`) confirms `submit(endpointId, options)` with `options.input`, optional `webhookUrl`, and optional queue/start-timeout settings; separate `status(endpointId, options)`, `result(endpointId, options)`, and `cancel(endpointId, options)` methods use the provider request ID. The adapter will mirror these contracts through server-side HTTP calls and will not ship the client SDK to the browser.
