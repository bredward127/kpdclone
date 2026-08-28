import { z } from "zod";
import type { BookBriefRecord, PagePlanRecord } from "./db-studio";
import { loadFalConfig } from "./fal";
import { FalProviderError, describeProviderBody } from "./fal-queue";

const draftPageSchema = z.object({ pageNumber: z.number().int().positive(), pageText: z.string().max(10_000), sceneDirection: z.string().max(10_000) });
const storyDraftSchema = z.object({ storySummary: z.string().min(1).max(20_000), pages: z.array(draftPageSchema).min(1).max(200) });
export type StoryDraft = z.infer<typeof storyDraftSchema>;

type FalTextResult = { output?: unknown; choices?: Array<{ message?: { content?: unknown } }> };

/**
 * Text drafting runs a real language model and takes tens of seconds. The queue
 * client's 5s timeout aborts the connection long before that, while FAL keeps
 * running and billing the completion, so every attempt was charged and none
 * could ever succeed. Default generously and let a deployment tune it.
 */
const DEFAULT_TEXT_TIMEOUT_MS = 120_000;
const MAX_TEXT_TIMEOUT_MS = 600_000;

export function textTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.FAL_TEXT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw < 1_000) return DEFAULT_TEXT_TIMEOUT_MS;
  return Math.min(Math.floor(raw), MAX_TEXT_TIMEOUT_MS);
}

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

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
  options: { targetPageNumbers?: number[]; fetchImpl?: typeof fetch } = {},
): Promise<StoryDraft> {
  const endpoint = requiredEnv(env, "FAL_TEXT_ENDPOINT");
  const model = requiredEnv(env, "FAL_TEXT_MODEL");
  const config = loadFalConfig(env);
  if (!config) throw new FalProviderError("FAL is not configured for this deployment.", { classification: "provider_http", retryable: false });
  const safeCount = Math.min(200, Math.max(1, Math.floor(pageCount)));
  const context = JSON.stringify({
    brief: brief ? { briefText: brief.briefText, bookType: brief.bookType, audience: brief.audience, visualStyleAnchors: brief.visualStyleAnchors, characterBible: brief.characterBible, negativePrompt: brief.negativePrompt } : null,
    existingPages: pages.map((page) => ({ pageNumber: page.pageNumber, pageText: page.pageText, sceneDirection: page.sceneDirection })),
  });
  /**
   * A targeted redraft rewrites only the named pages. Without this, adding one
   * page to a finished book re-planned all of it and discarded work the author
   * had already reviewed and edited.
   */
  const targets = (options.targetPageNumbers ?? []).filter((value) => Number.isInteger(value) && value > 0);
  const prompt = targets.length
    ? `An existing children's book plan is being extended. Rewrite ONLY page${targets.length === 1 ? "" : "s"} ${targets.join(", ")}. Return JSON only with this shape: {"storySummary":"...","pages":[{"pageNumber":1,"pageText":"...","sceneDirection":"..."}]}, whose "pages" array contains ONLY the rewritten page${targets.length === 1 ? "" : "s"} ${targets.join(", ")} and nothing else. Keep "storySummary" identical to the saved summary. The new page must fit the established characters, tone and continuity of the surrounding pages without contradicting or restating them. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content. Saved project context: ${context}`
    : `Create a complete original children's book plan with exactly ${safeCount} ordered pages. Return JSON only with this shape: {"storySummary":"...","pages":[{"pageNumber":1,"pageText":"...","sceneDirection":"..."}]}. Each page needs concise pageText and a specific visual sceneDirection. Preserve any non-empty existing page entries. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content. Saved project context: ${context}`;

  /**
   * The OpenAI-compatible chat-completions endpoint answers synchronously: the
   * POST returns the finished completion. It has no /requests/{id}/status
   * sub-path, so the previous queue submit-then-poll flow appended one to the
   * completions path and FAL answered 405 Method Not Allowed -- after the model
   * had already run and been billed. One request, one response, no polling.
   */
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${config.syncBaseUrl}/${endpoint.replace(/^\/+|\/+$/g, "")}`;
  const timeout = textTimeoutMs(env);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Key ${config.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "You are a children's book planning assistant. Produce original, age-appropriate story plans and visual directions." }, { role: "user", content: prompt }], temperature: 0.7, stream: false }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new FalProviderError(`FAL text drafting did not respond within ${Math.round(timeout / 1000)}s. The model may still be running and billable; wait before retrying.`, { classification: "provider_timeout", retryable: true });
  }

  const body = safeJson(await response.text());
  if (!response.ok) {
    const detail = describeProviderBody(body);
    throw new FalProviderError(`FAL rejected the text drafting request (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, { classification: "provider_http", retryable: response.status >= 500 || response.status === 429, providerStatus: response.status });
  }

  let text: string;
  try {
    text = extractText(body as FalTextResult);
  } catch {
    throw new Error("FAL text drafting returned no text output. The endpoint answered but carried no completion.");
  }

  let parsed: unknown;
  try {
    parsed = parseDraftJson(text);
  } catch {
    throw new Error(`FAL text drafting did not return JSON. The model replied with: ${text.slice(0, 300)}`);
  }

  const result = storyDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`FAL text drafting returned JSON that does not match the required story shape: ${result.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
  }
  if (!targets.length) return result.data;
  // Keep only the pages that were asked for, so a stray extra page in the reply
  // cannot overwrite work elsewhere in the book.
  const wanted = new Set(targets);
  const pagesForTargets = result.data.pages.filter((page) => wanted.has(page.pageNumber));
  if (!pagesForTargets.length) throw new Error(`FAL text drafting returned no content for page${targets.length === 1 ? "" : "s"} ${targets.join(", ")}.`);
  return { storySummary: result.data.storySummary, pages: pagesForTargets };
}
