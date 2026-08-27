import { describe, expect, it } from "vitest";
import { createRateLimiter, redactSensitive } from "../server/security";

describe("security utilities", () => {
  it("enforces bounded request quotas and exposes a retry window", () => {
    const limiter = createRateLimiter(60_000, 2);
    expect(limiter("user-a", 1).allowed).toBe(true);
    expect(limiter("user-a", 2).allowed).toBe(true);
    const blocked = limiter("user-a", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(limiter("user-b", 3).allowed).toBe(true);
  });

  it("redacts provider keys, authorization headers, signed URLs, and sensitive fields", () => {
    const secret = "fal_secret_test_value";
    const result = redactSensitive({ secret, authorization: "Bearer fal_secret_test_value", accessUrl: "/file?signature=abc&expires=123", nested: "x" }, [secret]) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("abc");
    expect(JSON.stringify(result)).not.toContain("123");
    expect(result.authorization).toBe("[REDACTED]");
  });
});
