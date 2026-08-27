import { afterEach, describe, expect, it } from "vitest";
import { isTestAuthEnabled, isValidTestAuthPassword } from "../server/auth";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("temporary test authentication", () => {
  it("is disabled unless explicitly enabled with a password", () => {
    delete process.env.TEST_AUTH_ENABLED;
    delete process.env.TEST_AUTH_PASSWORD;
    expect(isTestAuthEnabled()).toBe(false);

    process.env.TEST_AUTH_ENABLED = "true";
    expect(isTestAuthEnabled()).toBe(false);

    process.env.TEST_AUTH_PASSWORD = "private-test-password";
    expect(isTestAuthEnabled()).toBe(true);
  });

  it("accepts only the exact configured server-side password", () => {
    process.env.TEST_AUTH_ENABLED = "true";
    process.env.TEST_AUTH_PASSWORD = "private-test-password";
    expect(isValidTestAuthPassword("private-test-password")).toBe(true);
    expect(isValidTestAuthPassword("wrong-password")).toBe(false);
    expect(isValidTestAuthPassword("private-test-password ")).toBe(false);
    expect(isValidTestAuthPassword("")).toBe(false);
  });
});
