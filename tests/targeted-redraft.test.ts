import { describe, expect, it, vi } from "vitest";
import { draftStoryAndPages } from "../server/story-drafting";

const env = { FAL_KEY: "k", FAL_TEXT_ENDPOINT: "openrouter/router/openai/v1/chat/completions", FAL_TEXT_MODEL: "openai/gpt-4o" };
const reply = (payload: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });

describe("single-page redraft", () => {
  it("asks the model to rewrite only the named page", async () => {
    let sentBody = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sentBody = String(init?.body);
      return reply({ storySummary: "s", pages: [{ pageNumber: 25, pageText: "new", sceneDirection: "new scene" }] });
    });
    const result = await draftStoryAndPages(null, [], 25, env, { targetPageNumbers: [25] });
    expect(sentBody).toContain("Rewrite ONLY page 25");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(25);
    fetchMock.mockRestore();
  });

  it("discards extra pages so a redraft cannot overwrite the rest of the book", async () => {
    // The bug: adding one page redrafted the whole story and replaced pages the
    // author had already reviewed.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({
      storySummary: "s",
      pages: [
        { pageNumber: 1, pageText: "clobbered", sceneDirection: "clobbered" },
        { pageNumber: 2, pageText: "clobbered", sceneDirection: "clobbered" },
        { pageNumber: 25, pageText: "wanted", sceneDirection: "wanted scene" },
      ],
    }));
    const result = await draftStoryAndPages(null, [], 25, env, { targetPageNumbers: [25] });
    expect(result.pages.map((page) => page.pageNumber)).toEqual([25]);
    expect(result.pages[0].pageText).toBe("wanted");
    fetchMock.mockRestore();
  });

  it("fails clearly when the model returns nothing for the requested page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ storySummary: "s", pages: [{ pageNumber: 3, pageText: "x", sceneDirection: "y" }] }));
    await expect(draftStoryAndPages(null, [], 25, env, { targetPageNumbers: [25] })).rejects.toThrow(/returned no content for page 25/);
    fetchMock.mockRestore();
  });

  it("still drafts the whole book when no target is given", async () => {
    let sentBody = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sentBody = String(init?.body);
      return reply({ storySummary: "s", pages: [{ pageNumber: 1, pageText: "a", sceneDirection: "b" }, { pageNumber: 2, pageText: "c", sceneDirection: "d" }] });
    });
    const result = await draftStoryAndPages(null, [], 2, env);
    expect(sentBody).toContain("exactly 2 ordered pages");
    expect(result.pages).toHaveLength(2);
    fetchMock.mockRestore();
  });
});
