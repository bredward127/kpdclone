import { z } from "zod";
import type { BookBriefRecord, PagePlanRecord } from "./db-studio";
import { getFalQueueClient, FalProviderError } from "./fal-queue";

const draftPageSchema = z.object({ pageNumber: z.number().int().positive(), pageText: z.string().max(10_000), sceneDirection: z.string().max(10_000) });
const storyDraftSchema = z.object({ storySummary: z.string().min(1).max(20_000), pages: z.array(draftPageSchema).min(1).max(200) });
export type StoryDraft = z.infer<typeof storyDraftSchema>;

type FalTextResult = { output?: unknown; choices?: Array<{ message?: { content?: unknown } }> };

/**
 * Fragments that appear in the documentation's own descriptive placeholders for
 * these variables. A deployment that copies the guidance text into the value
 * instead of the identifier it describes reaches FAL and is rejected there with
 * a 400, far from the setting that caused it, so refuse it here with a message
 * that names the variable.
 */
const PLACEHOLDER_MARKERS = ["you-select", "you select", "the-current", "the current", "your-", "your ", "<", ">", "replace", "example", "changeme", "change-me", "todo", "xxx", "placeholder"];

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured for FAL text drafting.`);
  const lowered = value.toLowerCase();
  const marker = PLACEHOLDER_MARKERS.find((candidate) => lowered.includes(candidate));
  if (marker || /\s/.test(value)) {
    throw new Error(`${name} is set to "${value}", which looks like descriptive placeholder text rather than a real identifier. Set it to the actual value from the FAL endpoint's model documentation.`);
  }
  return value;
}

function extractText(result: FalTextResult): string {
  if (typeof result.output === "string") return result.output;
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  throw new Error("FAL text drafting returned no text output.");
}

/**
 * Chat models routinely wrap requested JSON in a markdown fence despite being
 * told to return JSON only. Strip one fence before parsing rather than failing
 * an otherwise valid draft.
 */
function parseDraftJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
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
    // A queued request that fails reports its reason here. Without this the loop
    // ignored it and spun out the full 90s only to report a generic timeout.
    if (status.error) throw new FalProviderError(`FAL text drafting failed: ${status.error}${status.errorType ? ` (${status.errorType})` : ""}`, { classification: "provider_http", retryable: false });
    if (status.status === "COMPLETED") {
      const result = await queue.result(endpoint, submitted.requestId) as FalTextResult;
      try { return storyDraftSchema.parse(parseDraftJson(extractText(result))); } catch { throw new Error("FAL text drafting returned invalid structured JSON."); }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new FalProviderError("FAL text drafting timed out before returning a result.", { classification: "provider_timeout", retryable: true });
}
