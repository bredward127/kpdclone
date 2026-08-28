import { describe, expect, it, vi } from "vitest";
import { draftStoryAndPages } from "../server/story-drafting";

describe("AI-assisted story drafting", () => {
  it("requires explicit server-side text drafting configuration", async () => {
    await expect(draftStoryAndPages(null, [], 24, {})).rejects.toThrow("FAL_TEXT_ENDPOINT is not configured");
  });

  it("parses a reviewable structured story and page draft", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.includes("/requests/") && target.endsWith("/status")) return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      if (target.includes("/requests/") && target.endsWith("/response")) return new Response(JSON.stringify({ output: JSON.stringify({ storySummary: "A kitten learns to ask for help.", pages: [{ pageNumber: 1, pageText: "Milo looked up.", sceneDirection: "An orange kitten looks up beneath a leafy plant." }] }) }), { status: 200 });
      expect(String(init?.body)).not.toContain("test-only");
      return new Response(JSON.stringify({ request_id: "text-request-1" }), { status: 200 });
    });
    const result = await draftStoryAndPages(null, [], 1, { FAL_KEY: "test-only", FAL_TEXT_ENDPOINT: "openrouter/router/openai/v1/chat/completions", FAL_TEXT_MODEL: "test-model" });
    expect(result.pages[0].sceneDirection).toContain("orange kitten");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockRestore();
  });
});
