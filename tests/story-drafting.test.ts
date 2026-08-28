import { describe, expect, it, vi } from "vitest";
import { draftStoryAndPages, textTimeoutMs } from "../server/story-drafting";

const env = { FAL_KEY: "test-only", FAL_TEXT_ENDPOINT: "openrouter/router/openai/v1/chat/completions", FAL_TEXT_MODEL: "openai/gpt-4o" };
const draft = { storySummary: "A kitten learns to ask for help.", pages: [{ pageNumber: 1, pageText: "Milo looked up.", sceneDirection: "An orange kitten looks up beneath a leafy plant." }] };
const completion = (content: string) => new Response(JSON.stringify({ object: "chat.completion", choices: [{ message: { role: "assistant", content } }] }), { status: 200 });

describe("AI-assisted story drafting", () => {
  it("requires explicit server-side text drafting configuration", async () => {
    await expect(draftStoryAndPages(null, [], 24, {})).rejects.toThrow("FAL_TEXT_ENDPOINT is not configured");
  });

  it("parses a reviewable structured story and page draft", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      expect(String(init?.body)).not.toContain("test-only");
      return completion(JSON.stringify(draft));
    });
    const result = await draftStoryAndPages(null, [], 1, env);
    expect(result.pages[0].sceneDirection).toContain("orange kitten");
    fetchMock.mockRestore();
  });

  it("issues exactly one request and never polls a queue status path", async () => {
    const seen: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      seen.push(`${init?.method ?? "GET"} ${String(url)}`);
      return completion(JSON.stringify(draft));
    });
    await draftStoryAndPages(null, [], 1, env);
    // The 405 regression: the OpenAI-compatible endpoint is synchronous, so any
    // /requests/{id}/status follow-up hits a POST-only path and is rejected --
    // after the model has already run and been billed.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe("POST https://fal.run/openrouter/router/openai/v1/chat/completions");
    expect(seen.some((entry) => entry.includes("/requests/"))).toBe(false);
    fetchMock.mockRestore();
  });

  it("reads a completion the model wrapped in a markdown code fence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion("```json\n" + JSON.stringify(draft) + "\n```"));
    await expect(draftStoryAndPages(null, [], 1, env)).resolves.toMatchObject({ storySummary: draft.storySummary });
    fetchMock.mockRestore();
  });

  it("reports the provider status and message when FAL rejects the request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad-model is not a valid model ID", code: 400 } }), { status: 400 }),
    );
    await expect(draftStoryAndPages(null, [], 1, env)).rejects.toThrow(/HTTP 400.*bad-model is not a valid model ID/);
    fetchMock.mockRestore();
  });

  it("explains a non-JSON reply instead of reporting a bare parse failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion("I cannot help with that request."));
    await expect(draftStoryAndPages(null, [], 1, env)).rejects.toThrow(/did not return JSON.*I cannot help with that request/s);
    fetchMock.mockRestore();
  });

  it("names the offending field when the JSON shape is wrong", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(JSON.stringify({ storySummary: "s", pages: [{ pageNumber: 0, pageText: "t", sceneDirection: "d" }] })));
    await expect(draftStoryAndPages(null, [], 1, env)).rejects.toThrow(/does not match the required story shape.*pages\.0\.pageNumber/s);
    fetchMock.mockRestore();
  });

  it("warns that a timed-out draft may still be billable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    await expect(draftStoryAndPages(null, [], 1, env)).rejects.toThrow(/did not respond within 120s.*still be running and billable/s);
    fetchMock.mockRestore();
  });
});

describe("text drafting timeout budget", () => {
  it("defaults far above a real model's response time", () => {
    // The old 5s queue timeout aborted at 5s while the model ran ~16s, so every
    // attempt was billed and none could succeed.
    expect(textTimeoutMs({})).toBe(120_000);
    expect(textTimeoutMs({})).toBeGreaterThan(16_000);
  });

  it("honours a configured budget within sane bounds", () => {
    expect(textTimeoutMs({ FAL_TEXT_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(textTimeoutMs({ FAL_TEXT_TIMEOUT_MS: "50" })).toBe(120_000);
    expect(textTimeoutMs({ FAL_TEXT_TIMEOUT_MS: "9999999" })).toBe(600_000);
    expect(textTimeoutMs({ FAL_TEXT_TIMEOUT_MS: "nonsense" })).toBe(120_000);
  });
});
