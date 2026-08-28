import { z } from "zod";
import type { BookBriefRecord, PagePlanRecord } from "./db-studio";
import { isColoringLineArt } from "../shared/coloring-book";
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

/**
 * One synchronous POST to the chat-completions endpoint, validated against a
 * schema. Shared by story drafting and brief drafting so both report provider
 * failures, non-JSON replies and shape mismatches the same way.
 */
async function requestStructuredDraft<T>(prompt: string, schema: z.ZodType<T>, env: NodeJS.ProcessEnv, fetchOverride?: typeof fetch): Promise<T> {
  const endpoint = requiredEnv(env, "FAL_TEXT_ENDPOINT");
  const model = requiredEnv(env, "FAL_TEXT_MODEL");
  const config = loadFalConfig(env);
  if (!config) throw new FalProviderError("FAL is not configured for this deployment.", { classification: "provider_http", retryable: false });
  const fetchImpl = fetchOverride ?? fetch;
  const url = `${config.syncBaseUrl}/${endpoint.replace(/^\/+|\/+$/g, "")}`;
  const timeout = textTimeoutMs(env);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Key ${config.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "You are a children's book planning assistant. Produce original, age-appropriate material. Return JSON only." }, { role: "user", content: prompt }], temperature: 0.7, stream: false }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new FalProviderError(`FAL did not respond within ${Math.round(timeout / 1000)}s. The model may still be running and billable; wait before retrying.`, { classification: "provider_timeout", retryable: true });
  }

  const body = safeJson(await response.text());
  if (!response.ok) {
    const detail = describeProviderBody(body);
    throw new FalProviderError(`FAL rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, { classification: "provider_http", retryable: response.status >= 500 || response.status === 429, providerStatus: response.status });
  }

  let text: string;
  try { text = extractText(body as FalTextResult); }
  catch { throw new Error("FAL returned no text output. The endpoint answered but carried no completion."); }

  let parsed: unknown;
  try { parsed = parseDraftJson(text); }
  catch { throw new Error(`FAL did not return JSON. The model replied with: ${text.slice(0, 300)}`); }

  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`FAL returned JSON that does not match the required shape: ${result.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
  return result.data;
}

export async function draftStoryAndPages(
  brief: BookBriefRecord | null,
  pages: PagePlanRecord[],
  pageCount: number,
  env: NodeJS.ProcessEnv = process.env,
  options: { targetPageNumbers?: number[]; interiorArtStyle?: string; fetchImpl?: typeof fetch } = {},
): Promise<StoryDraft> {
  const endpoint = requiredEnv(env, "FAL_TEXT_ENDPOINT");
  const model = requiredEnv(env, "FAL_TEXT_MODEL");
  const config = loadFalConfig(env);
  if (!config) throw new FalProviderError("FAL is not configured for this deployment.", { classification: "provider_http", retryable: false });
  const safeCount = Math.min(200, Math.max(1, Math.floor(pageCount)));
  const coloringPage = isColoringLineArt(options.interiorArtStyle);
  const context = JSON.stringify({
    brief: brief ? { briefText: brief.briefText, bookType: brief.bookType, audience: brief.audience, visualStyleAnchors: brief.visualStyleAnchors, characterBible: brief.characterBible, propAndSettingBible: brief.propAndSettingBible, negativePrompt: brief.negativePrompt } : null,
    existingPages: pages.map((page) => ({ pageNumber: page.pageNumber, pageText: page.pageText, sceneDirection: page.sceneDirection })),
  });
  /**
   * A targeted redraft rewrites only the named pages. Without this, adding one
   * page to a finished book re-planned all of it and discarded work the author
   * had already reviewed and edited.
   */
  const targets = (options.targetPageNumbers ?? []).filter((value) => Number.isInteger(value) && value > 0);
  /**
   * A coloring page is drawn to be coloured in, so its scene direction has to
   * describe shapes and layout rather than colour, light or mood, and has to
   * keep recurring objects identical between pages.
   */
  const styleGuidance = coloringPage
    ? ` This is a COLORING BOOK: every sceneDirection must describe a scene that works as black-and-white line art to be coloured in. Describe subjects, poses, arrangement and large open shapes. Do not mention colour, lighting, shadow, mood lighting, texture or painting technique. Each scene must be worth colouring: name the setting and several concrete objects in it (furniture, plants, toys, windows, patterns, background items), not just the character. Keep the objects large and clearly separated. Whenever a page shows an object or place that appears on another page, describe it with exactly the same words you used before so it can be drawn identically.`
    : ` Whenever a page shows an object or place that appears on another page, describe it with exactly the same words you used before so it can be drawn identically.`;
  const prompt = targets.length
    ? `An existing children's book plan is being extended. Rewrite ONLY page${targets.length === 1 ? "" : "s"} ${targets.join(", ")}. Return JSON only with this shape: {"storySummary":"...","pages":[{"pageNumber":1,"pageText":"...","sceneDirection":"..."}]}, whose "pages" array contains ONLY the rewritten page${targets.length === 1 ? "" : "s"} ${targets.join(", ")} and nothing else. Keep "storySummary" identical to the saved summary. The new page must fit the established characters, tone and continuity of the surrounding pages without contradicting or restating them. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content. Saved project context: ${context}${styleGuidance}`
    : `Create a complete original children's book plan with exactly ${safeCount} ordered pages. Return JSON only with this shape: {"storySummary":"...","pages":[{"pageNumber":1,"pageText":"...","sceneDirection":"..."}]}. Each page needs concise pageText and a specific visual sceneDirection. Preserve any non-empty existing page entries. Do not request copyrighted characters, trademarks, living artists' styles, or unsafe content.${styleGuidance} Saved project context: ${context}`;

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

const briefDraftSchema = z.object({
  briefText: z.string().min(1).max(4_000),
  audience: z.string().min(1).max(1_000),
  visualStyleAnchors: z.string().min(1).max(4_000),
  characterBible: z.string().min(1).max(6_000),
  propAndSettingBible: z.string().min(1).max(6_000),
  negativePrompt: z.string().min(1).max(2_000),
});
export type BriefDraft = z.infer<typeof briefDraftSchema>;

/**
 * Fill the whole brief from one line of intent, so an author does not have to
 * write six fields by hand before seeing anything. The prop and setting bible
 * matters most here: it is the field that keeps recurring objects stable
 * between pages, and it is the one an author is least likely to think to write.
 */
export async function draftBookBrief(
  idea: string,
  options: { interiorArtStyle?: string; bookType?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<BriefDraft> {
  const env = options.env ?? process.env;
  const coloringPage = isColoringLineArt(options.interiorArtStyle);
  const styleRule = coloringPage
    ? `This is a COLORING BOOK. visualStyleAnchors must describe line quality only -- stroke weight, shape language, how enclosed the shapes are, how much of the page is filled -- and must not mention colour, palette, lighting, shading or painting media.`
    : `visualStyleAnchors should describe palette, line quality, lighting and rendering method.`;
  const prompt = `Write the creative brief for a children's ${coloringPage ? "coloring book" : "picture book"}${options.bookType ? ` (${options.bookType})` : ""} from this idea: "${idea}".

Return JSON only, with exactly these keys: {"briefText","audience","visualStyleAnchors","characterBible","propAndSettingBible","negativePrompt"}.

- briefText: two or three sentences on the story and its emotional arc.
- audience: the reader age range and what that implies for vocabulary and page complexity.
- visualStyleAnchors: ${styleRule}
- characterBible: every recurring character, with the concrete physical details needed to redraw them identically -- proportions, hair, clothing, distinguishing marks.
- propAndSettingBible: every object and location that will appear on more than one page, each described concretely enough to be redrawn identically: shape, size, material, colour, and where it sits. Be specific; this text is repeated into every page prompt and is what stops an object changing between pages. Include at least four items.
- negativePrompt: what must never appear, including copyrighted characters, trademarks, living artists' styles and readable text.

Everything must be original. Do not name copyrighted characters, trademarks or living artists.`;
  return await requestStructuredDraft(prompt, briefDraftSchema, env, options.fetchImpl);
}
