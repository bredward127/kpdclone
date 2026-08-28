import { describe, expect, it, vi } from "vitest";
import { draftStoryAndPages } from "../server/story-drafting";

describe("AI-assisted story drafting", () => {
  it("requires explicit server-side text drafting configuration", async () => {
    await expect(draftStoryAndPages(null, [], 24, {})).rejects.toThrow("TEXT_DRAFT_API_KEY is not configured");
  });

  it("parses a reviewable structured story and page draft", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ storySummary: "A kitten learns to ask for help.", pages: [{ pageNumber: 1, pageText: "Milo looked up.", sceneDirection: "An orange kitten looks up beneath a leafy plant." }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await draftStoryAndPages(null, [], 1, { TEXT_DRAFT_API_KEY: "test-only", TEXT_DRAFT_MODEL: "test-model", TEXT_DRAFT_API_URL: "https://text.example.test/v1/chat/completions" });
    expect(result.pages[0].sceneDirection).toContain("orange kitten");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).not.toContain("test-only");
    fetchMock.mockRestore();
  });
});
