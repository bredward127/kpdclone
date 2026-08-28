import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../server/routers.ts", import.meta.url), "utf8");

/**
 * The generation submit and queueNext schemas carried /^\\d+:\\d+$/ -- a regex
 * literal whose \\ is an escaped backslash, so it only matched the literal text
 * "\d+:\d+". No real aspect ratio could pass, and every image submission was
 * rejected at the tRPC boundary before reaching the provider. The service tests
 * call the service directly and never exercise these schemas, so nothing caught
 * it.
 */
describe("router input schemas", () => {
  const aspectRatioPatterns = [...source.matchAll(/aspectRatio: z\.string\(\)[^,]*?\.regex\((\/[^/]+\/)\)/g)].map((match) => match[1]);

  it("declares an aspect-ratio pattern in every place that accepts one", () => {
    expect(aspectRatioPatterns.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts the aspect ratios the interface actually offers", () => {
    for (const literal of aspectRatioPatterns) {
      const body = literal.slice(1, -1);
      const regex = new RegExp(body);
      for (const value of ["1:1", "3:2", "2:3", "16:9"]) {
        expect(regex.test(value), `${literal} rejected ${value}`).toBe(true);
      }
    }
  });

  it("rejects values that are not two colon-separated numbers", () => {
    for (const literal of aspectRatioPatterns) {
      const regex = new RegExp(literal.slice(1, -1));
      for (const value of ["1:1 square", "square", "1-1", "", "1:"]) {
        expect(regex.test(value), `${literal} wrongly accepted ${JSON.stringify(value)}`).toBe(false);
      }
    }
  });

  it("contains no double-escaped regex literal in any zod schema", () => {
    // \\d inside a regex literal is a literal backslash, never a digit class.
    const offenders = [...source.matchAll(/z\.string\(\)[^,;]*?\.regex\(\/[^/]*\\\\[dws][^/]*\/\)/g)].map((match) => match[0]);
    expect(offenders).toEqual([]);
  });
});
