import crypto from "node:crypto";
import { loadFalConfig, type FalConfig } from "./fal";

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
export type FalWebhookStatus = "OK" | "ERROR";

export type FalSubmitResponse = {
  requestId: string;
  gatewayRequestId: string | null;
  responseUrl: string | null;
  statusUrl: string | null;
  cancelUrl: string | null;
};

export type FalStatusResponse = {
  status: FalQueueStatus;
  requestId: string;
  responseUrl?: string;
  queuePosition?: number;
  error?: string;
  errorType?: string;
};

export type FalWebhookPayload = {
  request_id: string;
  gateway_request_id?: string;
  status: FalWebhookStatus;
  payload?: unknown;
  error?: string;
  payload_error?: string;
};

export type FalImageOutput = {
  url: string;
  content_type?: string;
  file_name?: string;
  width?: number;
  height?: number;
};

export class FalProviderError extends Error {
  readonly classification: "provider_http" | "provider_timeout" | "provider_invalid_response" | "provider_cancelled" | "provider_not_found" | "result_download_expired" | "result_download_rejected";
  readonly retryable: boolean;
  readonly providerStatus: number | null;

  constructor(message: string, options: { classification: FalProviderError["classification"]; retryable: boolean; providerStatus?: number | null }) {
    super(message);
    this.name = "FalProviderError";
    this.classification = options.classification;
    this.retryable = options.retryable;
    this.providerStatus = options.providerStatus ?? null;
  }
}

type QueueDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function endpointPath(base: string, endpoint: string, suffix: string): string {
  return `${base}/${endpoint.replace(/^\/+|\/+$/g, "")}${suffix}`;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function providerError(response: Response, body: Record<string, unknown>): FalProviderError {
  const status = response.status;
  if (status === 404) return new FalProviderError("FAL request was not found.", { classification: "provider_not_found", retryable: false, providerStatus: status });
  return new FalProviderError("FAL rejected the queue operation.", { classification: "provider_http", retryable: status >= 500 || status === 429, providerStatus: status });
}

export function createFalQueueClient(config: FalConfig, dependencies: QueueDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs;
  const request = async (url: string, init: RequestInit): Promise<{ response: Response; body: Record<string, unknown> }> => {
    try {
      const response = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
      const body = safeJson(await response.text());
      if (!response.ok) throw providerError(response, body);
      return { response, body };
    } catch (error) {
      if (error instanceof FalProviderError) throw error;
      throw new FalProviderError("FAL queue operation timed out or could not be reached.", { classification: "provider_timeout", retryable: true });
    }
  };
  const headers = (extra: Record<string, string> = {}) => ({ Authorization: `Key ${config.apiKey}`, Accept: "application/json", "Content-Type": "application/json", ...extra });

  return {
    async submit(endpoint: string, input: Record<string, unknown>, options: { webhookUrl?: string } = {}): Promise<FalSubmitResponse> {
      const extra: Record<string, string> = options.webhookUrl ? { "x-fal-webhook-url": options.webhookUrl } : {};
      const { body } = await request(endpointPath(config.queueBaseUrl, endpoint, ""), { method: "POST", headers: headers(extra), body: JSON.stringify(input) });
      const requestId = typeof body.request_id === "string" ? body.request_id : "";
      if (!requestId) throw new FalProviderError("FAL returned an invalid queue request.", { classification: "provider_invalid_response", retryable: false });
      return { requestId, gatewayRequestId: typeof body.gateway_request_id === "string" ? body.gateway_request_id : null, responseUrl: typeof body.response_url === "string" ? body.response_url : null, statusUrl: typeof body.status_url === "string" ? body.status_url : null, cancelUrl: typeof body.cancel_url === "string" ? body.cancel_url : null };
    },
    async status(endpoint: string, requestId: string): Promise<FalStatusResponse> {
      const { body } = await request(endpointPath(config.queueBaseUrl, endpoint, `/requests/${encodeURIComponent(requestId)}/status`), { method: "GET", headers: headers() });
      if (body.status !== "IN_QUEUE" && body.status !== "IN_PROGRESS" && body.status !== "COMPLETED") throw new FalProviderError("FAL returned an invalid queue status.", { classification: "provider_invalid_response", retryable: false });
      return { status: body.status, requestId, responseUrl: typeof body.response_url === "string" ? body.response_url : undefined, queuePosition: typeof body.queue_position === "number" ? body.queue_position : undefined, error: typeof body.error === "string" ? body.error : undefined, errorType: typeof body.error_type === "string" ? body.error_type : undefined };
    },
    async result(endpoint: string, requestId: string): Promise<Record<string, unknown>> {
      const { body } = await request(endpointPath(config.queueBaseUrl, endpoint, `/requests/${encodeURIComponent(requestId)}/response`), { method: "GET", headers: headers() });
      return body;
    },
    async cancel(endpoint: string, requestId: string): Promise<"cancellation_requested" | "already_completed" | "not_found"> {
      try {
        const { body } = await request(endpointPath(config.queueBaseUrl, endpoint, `/requests/${encodeURIComponent(requestId)}/cancel`), { method: "POST", headers: headers(), body: "{}" });
        return body.status === "ALREADY_COMPLETED" ? "already_completed" : "cancellation_requested";
      } catch (error) {
        if (error instanceof FalProviderError && error.classification === "provider_not_found") return "not_found";
        if (error instanceof FalProviderError && error.providerStatus === 400) return "already_completed";
        throw error;
      }
    },
    async downloadImage(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new FalProviderError("FAL returned an invalid result URL.", { classification: "result_download_rejected", retryable: false }); }
      if (parsed.protocol !== "https:" || !(parsed.hostname === "fal.media" || parsed.hostname.endsWith(".fal.media"))) throw new FalProviderError("FAL result URL is not an approved media URL.", { classification: "result_download_rejected", retryable: false });
      try {
        const response = await fetchImpl(parsed.toString(), { method: "GET", headers: { Accept: "image/png,image/jpeg,image/webp" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new FalProviderError("FAL result URL expired or was unavailable.", { classification: "result_download_expired", retryable: response.status >= 500, providerStatus: response.status });
        const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
        if (!/^image\/(png|jpeg|webp)$/.test(contentType)) throw new FalProviderError("FAL result was not a supported image.", { classification: "result_download_rejected", retryable: false });
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > maxBytes) throw new FalProviderError("FAL result exceeds the configured image-size limit.", { classification: "result_download_rejected", retryable: false });
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (!buffer.byteLength || buffer.byteLength > maxBytes) throw new FalProviderError("FAL result exceeds the configured image-size limit.", { classification: "result_download_rejected", retryable: false });
        return { bytes: buffer, contentType };
      } catch (error) {
        if (error instanceof FalProviderError) throw error;
        throw new FalProviderError("FAL result download timed out or failed.", { classification: "result_download_expired", retryable: true });
      }
    },
  };
}

export function getFalQueueClient(env: NodeJS.ProcessEnv = process.env, dependencies: QueueDependencies = {}) {
  const config = loadFalConfig(env);
  if (!config) throw new FalProviderError("FAL is not configured for this deployment.", { classification: "provider_http", retryable: false });
  return createFalQueueClient(config, dependencies);
}

type Jwk = { kty: string; crv: string; x: string };
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

export async function verifyFalWebhookSignature(rawBody: Uint8Array, headers: Record<string, string | undefined>, dependencies: { fetchImpl?: typeof fetch; now?: () => number; jwksUrl?: string } = {}): Promise<boolean> {
  const requestId = headers["x-fal-webhook-request-id"];
  const userId = headers["x-fal-webhook-user-id"];
  const timestamp = headers["x-fal-webhook-timestamp"];
  const signature = headers["x-fal-webhook-signature"];
  if (!requestId || !userId || !timestamp || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) return false;
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const message = Buffer.from(`${requestId}\n${userId}\n${timestamp}\n${bodyHash}`, "utf8");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!jwksCache || jwksCache.expiresAt <= (dependencies.now?.() ?? Date.now())) {
    const response = await fetchImpl(dependencies.jwksUrl ?? "https://rest.fal.ai/.well-known/jwks.json", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return false;
    const json = await response.json() as { keys?: Jwk[] };
    jwksCache = { keys: Array.isArray(json.keys) ? json.keys.filter((key) => key.kty === "OKP" && key.crv === "Ed25519" && typeof key.x === "string") : [], expiresAt: (dependencies.now?.() ?? Date.now()) + 24 * 60 * 60 * 1000 };
  }
  const signatureBytes = Buffer.from(signature, "hex");
  return jwksCache.keys.some((jwk) => {
    try {
      const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
      return crypto.verify(null, message, publicKey, signatureBytes);
    } catch {
      return false;
    }
  });
}
