import type { Response } from "express";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number; remaining: number };
export function createRateLimiter(windowMs: number, max: number) {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  return (key: string, now = Date.now()): RateLimitResult => {
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) { buckets.set(key, { startedAt: now, count: 1 }); return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000), remaining: Math.max(0, max - 1) }; }
    current.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
    return { allowed: current.count <= max, retryAfterSeconds, remaining: Math.max(0, max - current.count) };
  };
}

export function applySecurityHeaders(res: Response): void {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export function applySafeDownloadHeaders(res: Response, filename: string, contentType: string): void {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
}

export function redactSensitive(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    let output = value;
    for (const secret of secrets.filter(Boolean)) output = output.split(secret).join("[REDACTED]");
    return output.replace(/(authorization\s*[:=]\s*(?:key|bearer)\s+)[^\s,;]+/gi, "$1[REDACTED]").replace(/(signature=)[^&\s]+/gi, "$1[REDACTED]").replace(/(expires=)\d+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [/key|token|secret|password|authorization|signedurl|accessurl/i.test(key) ? key : key, /key|token|secret|password|authorization/i.test(key) ? "[REDACTED]" : redactSensitive(item, secrets)]));
  return value;
}
