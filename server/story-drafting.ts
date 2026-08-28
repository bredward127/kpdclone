import { z } from "zod";
import type { BookBriefRecord, PagePlanRecord } from "./db-studio";
import { getFalQueueClient, FalProviderError } from "./fal-queue";

const draftPageSchema = z.object({ pageNumber: z.number().int().positive(), pageText: z.string().max(10_000), sceneDirection: z.string().max(10_000) });
const storyDraftSchema = z.object({ storySummary: z.string().min(1).max(20_000), pages: z.array(draftPageSchema).min(1).max(200) });
export type StoryDraft = z.infer<typeof storyDraftSchema>;

type FalTextResult = { output?: unknown; choices?: Array<{ message?: { content?: unknown } }> };

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured for FAL text drafting.`);
  return value;
}

function extractText(result: FalTextResult): string {
  if (typeof result.output === "string") return result.output;
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  throw new Error("FAL text drafting returned no text output.");
}

export async function draftStoryAndPages(
  brief: BookBriefRecord | null,
  pages: PagePlanRecord[],
  pageCount: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryDraft> {
  const endpoint = requiredEnv(env, "FAL_TEXT_ENDPOINT");
  const model = requiredEnv(env, "FAL_TEXT_MODEL");
  const safeCount = Math.min(200, Math.max(1, Math.floor(pageCount)));
  const context = JSON.stringify({
    brief: brief ? { briefText: brief.briefText, bookType: brief.bookType, audience: brief.audience, visualStyleAnchors: brief.visualStyleAnchors, characterBible: brief.characterBible, negativePrompt: brief.negativePrompt } : null,
    existingPages: pages.map((page) => ({ pageNumber: page.pageNumber, pageText: page.pageText, sceneDirection: page.sceneDirection })),
  });
  const prompt = `Create a complete original children's book plan with exactly ${safeCount} ordered pages. Return JSON only with this shape: {"storySummary":"...","pages":[{"pageNumber":1,"pageText":"...","sceneDirection":"..."}]}. Each page needs concise pageText and a specific visual sceneDirection. Preserve any non-empty existing page entries. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content. Saved project context: ${context}`;
  const queue = getFalQueueClient(env);
  const submitted = await queue.submit(endpoint, { model, messages: [{ role: "system", content: "You are a children's book planning assistant. Produce original, age-appropriate story plans and visual directions." }, { role: "user", content: prompt }], temperature: 0.7, stream: false });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await queue.status(endpoint, submitted.requestId);
    if (status.status === "COMPLETED") {
      const result = await queue.result(endpoint, submitted.requestId) as FalTextResult;
      try { return storyDraftSchema.parse(JSON.parse(extractText(result))); } catch { throw new Error("FAL text drafting returned invalid structured JSON."); }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new FalProviderError("FAL text drafting timed out before returning a result.", { classification: "provider_timeout", retryable: true });
}
