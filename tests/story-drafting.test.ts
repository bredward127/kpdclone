import { describe, expect, it, vi } from "vitest";
import { draftCoverCopy, draftStoryAndPages, textTimeoutMs } from "../server/story-drafting";
import type { BookBriefRecord, PagePlanRecord } from "../server/db-studio";

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

describe("AI-assisted cover copy drafting", () => {
  const brief: BookBriefRecord = {
    id: "brief-1", userId: "u1", projectId: "p1",
    briefText: "A shy raccoon learns to ask for help in a moonlit forest.",
    bookType: "picture_book", audience: "ages 4-8",
    visualStyleAnchors: "Indigo gouache.", characterBible: "Remy is a small grey raccoon with a striped tail.",
    propAndSettingBible: "", negativePrompt: "No logos.",
    version: 1, status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const page = (n: number, scene: string): PagePlanRecord => ({
    id: `page-${n}`, userId: "u1", projectId: "p1", pageNumber: n, spreadNumber: null,
    sceneDirection: scene, pageText: `Text ${n}.`, approvalState: "draft", rejectionReason: null,
    status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const coverDraft = { title: "Remy's Moonlit Bravery", subtitle: "A little raccoon finds his courage", backCoverCopy: "Remy is scared of the dark forest, until he learns that asking for help is its own kind of brave." };

  it("drafts title, subtitle, and back-cover copy from the saved story", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find((m: { role: string }) => m.role === "user").content as string;
      // The brief and character bible must reach the model as context.
      expect(userMessage).toContain("shy raccoon");
      expect(userMessage).toContain("Remy is a small grey raccoon");
      return completion(JSON.stringify(coverDraft));
    });
    const result = await draftCoverCopy(brief, [page(1, "Remy peeks from his den.")], { env });
    expect(result).toEqual(coverDraft);
    fetchMock.mockRestore();
  });

  it("never asks the model for author name or imprint -- those are the creator's own identity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find((m: { role: string }) => m.role === "user").content as string;
      // The JSON schema the model is told to fill must request only these
      // three keys -- it must never ask for an "author" or "imprint" value.
      // (The word "author" legitimately appears elsewhere, in an instruction
      // telling the model NOT to invent one for the back-cover blurb.)
      const schemaLine = userMessage.match(/\{"title".*?\}/)?.[0] ?? "";
      expect(schemaLine).toBeTruthy();
      expect(schemaLine.toLowerCase()).not.toContain("author");
      expect(schemaLine.toLowerCase()).not.toContain("imprint");
      // The context payload sent to the model must not carry a real author or
      // imprint value either, even though the brief record type has no such
      // fields to leak in the first place.
      const contextMatch = userMessage.match(/context: (\{.*?\})\n/);
      expect(contextMatch).toBeTruthy();
      const context = JSON.parse(contextMatch![1]);
      expect(context).not.toHaveProperty("author");
      expect(context).not.toHaveProperty("imprint");
      return completion(JSON.stringify(coverDraft));
    });
    const result = await draftCoverCopy(brief, [], { env });
    expect(Object.keys(result).sort()).toEqual(["backCoverCopy", "subtitle", "title"]);
    fetchMock.mockRestore();
  });

  it("samples a long book's pages instead of sending all of them", async () => {
    const pages = Array.from({ length: 40 }, (_, i) => page(i + 1, `Scene ${i + 1}.`));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find((m: { role: string }) => m.role === "user").content as string;
      const match = userMessage.match(/"sampleScenes":(\[.*?\])/);
      expect(match).toBeTruthy();
      const sampled = JSON.parse(match![1]);
      // A 40-page book must not push every scene into the prompt.
      expect(sampled.length).toBeLessThan(pages.length);
      expect(sampled.length).toBeLessThanOrEqual(6);
      // The ending should still be represented, not just the opening.
      expect(sampled.some((s: { pageNumber: number }) => s.pageNumber === 40)).toBe(true);
      return completion(JSON.stringify(coverDraft));
    });
    await draftCoverCopy(brief, pages, { env });
    fetchMock.mockRestore();
  });

  it("works from pages alone when no brief has been saved yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(JSON.stringify(coverDraft)));
    const result = await draftCoverCopy(null, [page(1, "A quiet morning.")], { env });
    expect(result.title).toBe(coverDraft.title);
    fetchMock.mockRestore();
  });

  it("coerces an object the model returns for a text field instead of failing outright", async () => {
    // The same failure mode as the brief drafter: a model occasionally returns
    // a nested object where a plain string was asked for.
    const malformed = { ...coverDraft, subtitle: { nested: "oops" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(JSON.stringify(malformed)));
    const result = await draftCoverCopy(brief, [], { env });
    expect(typeof result.subtitle).toBe("string");
    fetchMock.mockRestore();
  });

  it("rejects a reply missing a required field", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(JSON.stringify({ subtitle: "s", backCoverCopy: "b" })));
    await expect(draftCoverCopy(brief, [], { env })).rejects.toThrow(/does not match the required shape/);
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
