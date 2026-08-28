import { describe, expect, it, vi } from "vitest";
import { createFalQueueClient, describeProviderBody, FalProviderError } from "../server/fal-queue";
import { draftStoryAndPages } from "../server/story-drafting";

const config = { apiKey: "test-only", baseUrl: "https://api.fal.ai", queueBaseUrl: "https://queue.fal.run", timeoutMs: 5_000 };

describe("FAL error bodies are reported, not discarded", () => {
  it("reads the OpenAI-compatible router's error shape", () => {
    expect(describeProviderBody({ error: { message: "some-model is not a valid model ID", code: 400 } })).toBe("some-model is not a valid model ID");
  });

  it("reads a gateway detail string and a FastAPI validation list", () => {
    expect(describeProviderBody({ detail: "Unauthorized." })).toBe("Unauthorized.");
    expect(describeProviderBody({ detail: [{ loc: ["body", "model"], msg: "field required" }] })).toBe("body.model: field required");
  });

  it("returns an empty string when the body carries no reason", () => {
    expect(describeProviderBody({})).toBe("");
    expect(describeProviderBody({ error: {} })).toBe("");
  });

  it("surfaces the provider's status and message on a rejected submit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad-model-id is not a valid model ID", code: 400 } }), { status: 400 }),
    );
    const queue = createFalQueueClient(config);
    await expect(queue.submit("some/endpoint", {})).rejects.toThrow(/HTTP 400.*bad-model-id is not a valid model ID/);
    await expect(queue.submit("some/endpoint", {})).rejects.toBeInstanceOf(FalProviderError);
    fetchMock.mockRestore();
  });

  it("still names the status when the body is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    const queue = createFalQueueClient(config);
    await expect(queue.submit("some/endpoint", {})).rejects.toThrow("FAL rejected the queue operation (HTTP 401).");
    fetchMock.mockRestore();
  });
});

describe("placeholder deployment values are refused before reaching FAL", () => {
  const base = { FAL_KEY: "test-only", FAL_TEXT_ENDPOINT: "openrouter/router/openai/v1/chat/completions" };

  it("rejects the documentation placeholder that caused the live 400", async () => {
    await expect(draftStoryAndPages(null, [], 24, { ...base, FAL_TEXT_MODEL: "the-current-model-identifier-you-select-in-FAL" }))
      .rejects.toThrow(/FAL_TEXT_MODEL is set to .*looks like descriptive placeholder text/);
  });

  it("rejects other placeholder shapes and free prose", async () => {
    for (const value of ["<your-model-here>", "your-model", "TODO", "replace me", "the current text model"]) {
      await expect(draftStoryAndPages(null, [], 24, { ...base, FAL_TEXT_MODEL: value })).rejects.toThrow(/placeholder text/);
    }
  });

  it("accepts a real vendor/model identifier and a real endpoint path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      if (target.endsWith("/status")) return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      if (target.endsWith("/response")) return new Response(JSON.stringify({ output: JSON.stringify({ storySummary: "s", pages: [{ pageNumber: 1, pageText: "t", sceneDirection: "d" }] }) }), { status: 200 });
      return new Response(JSON.stringify({ request_id: "r1" }), { status: 200 });
    });
    const result = await draftStoryAndPages(null, [], 1, { ...base, FAL_TEXT_MODEL: "openai/gpt-4o" });
    expect(result.pages).toHaveLength(1);
    fetchMock.mockRestore();
  });
});

describe("story drafting handles real provider behaviour", () => {
  const env = { FAL_KEY: "test-only", FAL_TEXT_ENDPOINT: "openrouter/router/openai/v1/chat/completions", FAL_TEXT_MODEL: "openai/gpt-4o" };

  it("fails immediately on a queue status error instead of spinning to timeout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      if (target.endsWith("/status")) return new Response(JSON.stringify({ status: "IN_QUEUE", error: "model unavailable", error_type: "ModelError" }), { status: 200 });
      return new Response(JSON.stringify({ request_id: "r1" }), { status: 200 });
    });
    await expect(draftStoryAndPages(null, [], 1, env)).rejects.toThrow(/FAL text drafting failed: model unavailable \(ModelError\)/);
    fetchMock.mockRestore();
  });

  it("parses a draft the model wrapped in a markdown code fence", async () => {
    const draft = { storySummary: "A kitten asks for help.", pages: [{ pageNumber: 1, pageText: "Milo looked up.", sceneDirection: "An orange kitten under a leaf." }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      if (target.endsWith("/status")) return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      if (target.endsWith("/response")) return new Response(JSON.stringify({ output: "```json\n" + JSON.stringify(draft) + "\n```" }), { status: 200 });
      return new Response(JSON.stringify({ request_id: "r1" }), { status: 200 });
    });
    const result = await draftStoryAndPages(null, [], 1, env);
    expect(result.storySummary).toContain("kitten");
    fetchMock.mockRestore();
  });
});
