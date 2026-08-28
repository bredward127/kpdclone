import { z } from "zod";
import type { BookBriefRecord, PagePlanRecord } from "./db-studio";

const draftPageSchema = z.object({ pageNumber: z.number().int().positive(), pageText: z.string().max(10_000), sceneDirection: z.string().max(10_000) });
const storyDraftSchema = z.object({ storySummary: z.string().min(1).max(20_000), pages: z.array(draftPageSchema).min(1).max(200) });
export type StoryDraft = z.infer<typeof storyDraftSchema>;

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured for AI-assisted planning.`);
  return value;
}

export async function draftStoryAndPages(
  brief: BookBriefRecord | null,
  pages: PagePlanRecord[],
  pageCount: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoryDraft> {
  const apiKey = requiredEnv(env, "TEXT_DRAFT_API_KEY");
  const apiUrl = (env.TEXT_DRAFT_API_URL?.trim() || "https://api.openai.com/v1/chat/completions").replace(/\/$/, "");
  const model = requiredEnv(env, "TEXT_DRAFT_MODEL");
  const safeCount = Math.min(200, Math.max(1, Math.floor(pageCount)));
  const context = JSON.stringify({ brief: brief ? { briefText: brief.briefText, bookType: brief.bookType, audience: brief.audience, visualStyleAnchors: brief.visualStyleAnchors, characterBible: brief.characterBible, negativePrompt: brief.negativePrompt } : null, existingPages: pages.map((page) => ({ pageNumber: page.pageNumber, pageText: page.pageText, sceneDirection: page.sceneDirection })) });
  const response = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.7, messages: [{ role: "system", content: "You are a children's book planning assistant. Return JSON only. Create original, age-appropriate story text and specific visual scene directions. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content. Preserve any non-empty existing page entries rather than overwriting them." }, { role: "user", content: `Create a complete story summary and exactly ${safeCount} ordered page plans from this saved project context. Each page must have concise pageText and a visual sceneDirection. Existing blank pages may be filled; existing non-empty pages should be preserved. Context: ${context}` }], response_format: { type: "json_object" } }) });
  if (!response.ok) throw new Error("The text drafting service could not create a plan.");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The text drafting service returned no plan.");
  try { return storyDraftSchema.parse(JSON.parse(content)); } catch { throw new Error("The text drafting service returned an invalid page plan."); }
}
