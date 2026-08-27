import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { getProjectForUser } from "./db";
import { getBriefForProject, getPagePlanForUser } from "./db-studio";
import { listReferenceAssets, assertReferenceCanBeUsedForGeneration, type ReferenceAssetRecord } from "./reference-assets";

export type PromptLintSeverity = "warning";
export type PromptLintCode =
  | "missing_subject"
  | "vague_style"
  | "inconsistent_age_style"
  | "unsupported_visual_asset"
  | "copyright_or_trademark_request"
  | "living_artist_style_request"
  | "sexual_or_minor_content"
  | "conflicting_print_constraints";

export type PromptLintWarning = {
  code: PromptLintCode;
  severity: PromptLintSeverity;
  message: string;
  evidence: string;
  section: string;
};

export type PromptUserEdits = {
  promptAddition?: string;
  negativePromptAddition?: string;
  compositionNotes?: string;
};

export type PromptCompositionInput = {
  projectId: string;
  pagePlanId: string;
  generationModel: string;
  generationEndpoint: string;
  aspectRatio: string;
  seed?: number;
  referenceAssetIds: string[];
  userEdits?: PromptUserEdits;
};

export type PromptSourceSnapshot = {
  bookProject: {
    id: string;
    name: string;
    brief: string;
    title: string;
    author: string;
    imprint: string;
    bookType: string;
    readingDirection: string;
    trimWidthInches: number;
    trimHeightInches: number;
    bleedPreference: string;
    paperSelection: string;
    inkSelection: string;
    pageCount: number;
  };
  bookBrief: ReturnType<typeof getBriefForProject>;
  pagePlan: ReturnType<typeof getPagePlanForUser>;
  approvedReferenceAssets: ReadonlyArray<Pick<ReferenceAssetRecord, "id" | "referenceKind" | "originalFilename" | "widthPx" | "heightPx" | "contentHashSha256" | "provenanceDeclaration">>;
  requestedReferenceAssetIds: ReadonlyArray<string>;
};

export type ComposedPrompt = {
  prompt: string;
  negativePrompt: string;
  sourceFieldSnapshot: PromptSourceSnapshot;
  userEdits: PromptUserEdits;
  generationModel: string;
  generationEndpoint: string;
  aspectRatio: string;
  seed: number | null;
  referenceAssetIds: string[];
  lintWarnings: PromptLintWarning[];
  contentHashSha256: string;
};

export type PromptVersionRecord = {
  id: string;
  userId: string;
  projectId: string;
  pagePlanId: string | null;
  version: number;
  prompt: string;
  negativePrompt: string;
  sourceFieldSnapshot: PromptSourceSnapshot;
  userEdits: PromptUserEdits;
  generationModel: string;
  generationEndpoint: string;
  aspectRatio: string;
  seed: number | null;
  referenceAssetIds: string[];
  lintWarnings: PromptLintWarning[];
  contentHashSha256: string;
  status: string;
  restoredFromPromptVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hashPrompt(value: Omit<ComposedPrompt, "contentHashSha256">): string {
  return crypto.createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function section(label: string, lines: string[]): string {
  return [`[${label}]`, ...lines.filter((line) => clean(line)).map(clean)].join("\n");
}

function lintPrompt(input: {
  project: PromptSourceSnapshot["bookProject"];
  brief: PromptSourceSnapshot["bookBrief"];
  pagePlan: PromptSourceSnapshot["pagePlan"];
  userEdits: PromptUserEdits;
  requestedReferenceAssetIds: ReadonlyArray<string>;
  approvedReferenceAssetIds: string[];
  prompt: string;
  negativePrompt: string;
}): PromptLintWarning[] {
  const warnings: PromptLintWarning[] = [];
  const allText = `${input.project.brief}\n${input.brief?.briefText ?? ""}\n${input.brief?.visualStyleAnchors ?? ""}\n${input.brief?.characterBible ?? ""}\n${input.pagePlan?.sceneDirection ?? ""}\n${input.userEdits.promptAddition ?? ""}`;
  const lower = allText.toLowerCase();
  const style = clean(input.brief?.visualStyleAnchors);
  const audience = clean(input.brief?.audience);
  const scene = clean(input.pagePlan?.sceneDirection);

  if (!scene || /^(an? image|a picture|something nice|make it beautiful|scene)$/i.test(scene)) {
    warnings.push({ code: "missing_subject", severity: "warning", message: "Add a concrete subject and action to the page scene direction.", evidence: scene || "No scene direction supplied.", section: "specific page scene" });
  }
  if (!style || /^(nice|beautiful|cute|good|cool|storybook|colorful)$/i.test(style)) {
    warnings.push({ code: "vague_style", severity: "warning", message: "Name observable visual rules such as palette, line quality, lighting, texture, and rendering method instead of a general mood word.", evidence: style || "No visual-style anchors supplied.", section: "visual style" });
  }
  const ageText = `${input.project.bookType} ${audience} ${input.brief?.characterBible ?? ""} ${input.brief?.briefText ?? ""}`.toLowerCase();
  if (/(adult|grown[- ]?up|mature)\b/.test(ageText) && /(toddler|preschool|child|children|kids|early reader|minor)\b/.test(ageText)) {
    warnings.push({ code: "inconsistent_age_style", severity: "warning", message: "The saved audience and character/age declarations appear inconsistent; review the intended reader and visual treatment.", evidence: `${audience} / ${input.brief?.characterBible ?? ""}`, section: "intended audience" });
  }
  const unsupported = input.requestedReferenceAssetIds.filter((id) => !input.approvedReferenceAssetIds.includes(id));
  for (const id of unsupported) warnings.push({ code: "unsupported_visual_asset", severity: "warning", message: "This visual reference is unavailable, deleted, not owned by the current user, or lacks the required rights attestation, so it was not included as a generation input.", evidence: id, section: "character/setting continuity" });
  if (/\b(disney|pixar|marvel|pokemon|copyright|trademark|registered mark|brand logo|use the logo)\b/i.test(allText)) {
    warnings.push({ code: "copyright_or_trademark_request", severity: "warning", message: "Review the request for protected characters, trademarks, logos, or copyrighted material and replace it with original descriptive language where appropriate.", evidence: allText.match(/\b(disney|pixar|marvel|pokemon|copyright|trademark|registered mark|brand logo|use the logo)\b/i)?.[0] ?? "protected reference", section: "book identity" });
  }
  if (/\b(in the style of|style of|imitate|copy the style|like [a-z]+ artist)\b/i.test(allText)) {
    warnings.push({ code: "living_artist_style_request", severity: "warning", message: "Avoid requesting a living artist’s distinctive style; describe independent visual attributes instead.", evidence: allText.match(/\b(in the style of|style of|imitate|copy the style)\b/i)?.[0] ?? "style imitation language", section: "visual style" });
  }
  if (/(child|minor|toddler|underage|young girl|young boy)/i.test(allText) && /(sexual|nude|naked|erotic|seductive|explicit|fetish)/i.test(allText)) {
    warnings.push({ code: "sexual_or_minor_content", severity: "warning", message: "Review the request: sexualized content involving a minor or child-coded subject is not allowed.", evidence: "minor/child and sexualized terms detected", section: "specific page scene" });
  }
  if ((input.project.bleedPreference === "no_bleed" && /full[- ]?bleed|edge[- ]to[- ]edge|bleed off the page/i.test(`${input.prompt}\n${input.userEdits.compositionNotes ?? ""}`)) || (input.project.bleedPreference === "bleed" && /keep all content inside trim|no bleed/i.test(input.userEdits.compositionNotes ?? ""))) {
    warnings.push({ code: "conflicting_print_constraints", severity: "warning", message: "The page direction conflicts with the project bleed preference; resolve the print-safe boundary before generation.", evidence: input.project.bleedPreference, section: "print-safe requirements" });
  }
  return warnings;
}

export function composePrompt(input: {
  source: PromptSourceSnapshot;
  generationModel: string;
  generationEndpoint: string;
  aspectRatio: string;
  seed?: number;
  referenceAssetIds: string[];
  userEdits?: PromptUserEdits;
}): ComposedPrompt {
  const userEdits = {
    promptAddition: clean(input.userEdits?.promptAddition),
    negativePromptAddition: clean(input.userEdits?.negativePromptAddition),
    compositionNotes: clean(input.userEdits?.compositionNotes),
  };
  const project = input.source.bookProject;
  const brief = input.source.bookBrief;
  const page = input.source.pagePlan;
  const references = input.source.approvedReferenceAssets;
  const promptSections = [
    section("BOOK IDENTITY", [`Title: ${project.title || project.name}`, `Author: ${project.author || "Not supplied"}`, `Imprint: ${project.imprint || "Not supplied"}`, `Book type: ${project.bookType}`]),
    section("INTENDED AUDIENCE", [`Audience: ${brief?.audience || "Not supplied"}`, `Reading direction: ${project.readingDirection}`]),
    section("CHARACTER/SETTING CONTINUITY", [`Character bible: ${brief?.characterBible || "Not supplied"}`, `Visual-style anchors carried into continuity: ${brief?.visualStyleAnchors || "Not supplied"}`, `Approved reference assets: ${references.length ? references.map((reference) => `${reference.referenceKind} — ${reference.originalFilename} (${reference.id})`).join("; ") : "None"}`]),
    section("SPECIFIC PAGE SCENE", [`Page ${page?.pageNumber ?? "?"}: ${page?.sceneDirection || "Not supplied"}`, `Page text: ${page?.pageText || "No text supplied"}`]),
    section("VISUAL STYLE", [`${brief?.visualStyleAnchors || "Describe palette, line quality, lighting, texture, and rendering method."}`, `The visual treatment must remain original and consistent with the saved character bible.`]),
    section("COMPOSITION", [`Spread/page number: ${page?.pageNumber ?? "?"}`, `Composition notes: ${userEdits.compositionNotes || "Keep the focal subject clear with readable silhouette and intentional negative space for the page layout."}`, `Reading direction: ${project.readingDirection}`]),
    section("PRINT-SAFE REQUIREMENTS", [`Trim: ${project.trimWidthInches} × ${project.trimHeightInches} inches`, `Bleed preference: ${project.bleedPreference}`, `Paper: ${project.paperSelection}; ink: ${project.inkSelection}`, `Keep critical characters and details inside the safe area; avoid accidental text, borders, or watermarks.`]),
    section("NEGATIVE CONSTRAINTS", [`${brief?.negativePrompt || "No muddy anatomy, extra limbs, accidental text, logos, watermarks, or cropped focal subjects."}`, userEdits.negativePromptAddition]),
    section("MODEL-SPECIFIC PARAMETERS", [`Model: ${input.generationModel}`, `Endpoint: ${input.generationEndpoint}`, `Aspect ratio: ${input.aspectRatio}`, `Seed: ${input.seed ?? "provider default"}`]),
  ];
  const prompt = [...promptSections, userEdits.promptAddition ? section("USER EDITS — VERBATIM", [userEdits.promptAddition]) : ""].filter(Boolean).join("\n\n");
  const negativePrompt = [clean(brief?.negativePrompt), userEdits.negativePromptAddition].filter(Boolean).join("\n");
  const lintWarnings = lintPrompt({ project, brief, pagePlan: page, userEdits, requestedReferenceAssetIds: input.source.requestedReferenceAssetIds, approvedReferenceAssetIds: references.map((reference) => reference.id), prompt, negativePrompt });
  const resultWithoutHash = { prompt, negativePrompt, sourceFieldSnapshot: input.source, userEdits, generationModel: input.generationModel, generationEndpoint: input.generationEndpoint, aspectRatio: input.aspectRatio, seed: input.seed ?? null, referenceAssetIds: references.map((reference) => reference.id), lintWarnings };
  return { ...resultWithoutHash, contentHashSha256: hashPrompt(resultWithoutHash) };
}

function rowToPromptVersion(row: Record<string, unknown>, referenceAssetIds: string[]): PromptVersionRecord {
  return {
    id: String(row.id), userId: String(row.userId), projectId: String(row.projectId), pagePlanId: row.pagePlanId ? String(row.pagePlanId) : null,
    version: Number(row.version), prompt: String(row.prompt), negativePrompt: String(row.negativePrompt), sourceFieldSnapshot: JSON.parse(String(row.sourceFieldSnapshot)), userEdits: JSON.parse(String(row.userEdits)), generationModel: String(row.generationModel), generationEndpoint: String(row.generationEndpoint), aspectRatio: String(row.aspectRatio), seed: row.seed === null ? null : Number(row.seed), referenceAssetIds, lintWarnings: JSON.parse(String(row.lintWarningsJson)), contentHashSha256: String(row.contentHashSha256), status: String(row.status), restoredFromPromptVersionId: row.restoredFromPromptVersionId ? String(row.restoredFromPromptVersionId) : null, createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
  };
}

function promptVersionSelect(): string {
  return `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
                 version, prompt, negative_prompt AS negativePrompt,
                 source_field_snapshot AS sourceFieldSnapshot, user_edits AS userEdits,
                 generation_model AS generationModel, generation_endpoint AS generationEndpoint,
                 aspect_ratio AS aspectRatio, seed, lint_warnings_json AS lintWarningsJson,
                 content_hash_sha256 AS contentHashSha256, status,
                 restored_from_prompt_version_id AS restoredFromPromptVersionId,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM prompt_versions`;
}

function referenceIdsForPrompt(db: AppDatabase, userId: string, promptVersionId: string): string[] {
  return (db.prepare(`SELECT reference_asset_id AS id FROM prompt_reference_assets WHERE user_id = ? AND prompt_version_id = ? ORDER BY reference_asset_id`).all(userId, promptVersionId) as Array<{ id: string }>).map((row) => row.id);
}

export function getPromptVersionForUser(db: AppDatabase, userId: string, promptVersionId: string): PromptVersionRecord | null {
  const row = db.prepare(`${promptVersionSelect()} WHERE id = ? AND user_id = ?`).get(promptVersionId, userId) as Record<string, unknown> | undefined;
  return row ? rowToPromptVersion(row, referenceIdsForPrompt(db, userId, promptVersionId)) : null;
}

export function listPromptVersions(db: AppDatabase, userId: string, projectId: string, pagePlanId: string): PromptVersionRecord[] {
  const rows = db.prepare(`${promptVersionSelect()} WHERE user_id = ? AND project_id = ? AND page_plan_id = ? ORDER BY version DESC`).all(userId, projectId, pagePlanId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToPromptVersion(row, referenceIdsForPrompt(db, userId, String(row.id))));
}

export function createPromptVersion(db: AppDatabase, userId: string, composed: ComposedPrompt, input: PromptCompositionInput, restoredFromPromptVersionId: string | null = null): PromptVersionRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const versionRow = db.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM prompt_versions WHERE user_id = ? AND project_id = ? AND page_plan_id = ?`).get(userId, input.projectId, input.pagePlanId) as { nextVersion: number };
  const version = versionRow.nextVersion;
  const result = db.transaction(() => {
    db.prepare(`INSERT INTO prompt_versions
      (id, user_id, project_id, page_plan_id, version, prompt, negative_prompt,
       source_field_snapshot, user_edits, seed, generation_model, generation_endpoint,
       aspect_ratio, content_hash_sha256, lint_warnings_json, restored_from_prompt_version_id,
       status, created_at, updated_at)
      VALUES (@id, @userId, @projectId, @pagePlanId, @version, @prompt, @negativePrompt,
              @sourceFieldSnapshot, @userEdits, @seed, @generationModel, @generationEndpoint,
              @aspectRatio, @contentHashSha256, @lintWarningsJson, @restoredFromPromptVersionId,
              'draft', @now, @now)`).run({ id, userId, projectId: input.projectId, pagePlanId: input.pagePlanId, version, prompt: composed.prompt, negativePrompt: composed.negativePrompt, sourceFieldSnapshot: JSON.stringify(composed.sourceFieldSnapshot), userEdits: JSON.stringify(composed.userEdits), seed: composed.seed, generationModel: composed.generationModel, generationEndpoint: composed.generationEndpoint, aspectRatio: composed.aspectRatio, contentHashSha256: composed.contentHashSha256, lintWarningsJson: JSON.stringify(composed.lintWarnings), restoredFromPromptVersionId, now });
    const insertLink = db.prepare(`INSERT INTO prompt_reference_assets (id, user_id, project_id, prompt_version_id, reference_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const referenceAssetId of composed.referenceAssetIds) insertLink.run(crypto.randomUUID(), userId, input.projectId, id, referenceAssetId, now, now);
  })();
  void result;
  return getPromptVersionForUser(db, userId, id)!;
}

export function composePromptFromSavedProject(db: AppDatabase, userId: string, input: PromptCompositionInput): ComposedPrompt {
  const projectRow = db.prepare(`SELECT id, name, brief, title, author, imprint, book_type AS bookType, reading_direction AS readingDirection, trim_width_inches AS trimWidthInches, trim_height_inches AS trimHeightInches, bleed_preference AS bleedPreference, paper_selection AS paperSelection, ink_selection AS inkSelection, page_count AS pageCount FROM book_projects WHERE id = ? AND user_id = ?`).get(input.projectId, userId) as PromptSourceSnapshot["bookProject"] | undefined;
  if (!projectRow) throw new Error("Project not found.");
  const brief = getBriefForProject(db, userId, input.projectId);
  const pagePlan = getPagePlanForUser(db, userId, input.pagePlanId);
  if (!pagePlan || pagePlan.projectId !== input.projectId) throw new Error("Page plan not found.");
  const activeReferences = listReferenceAssets(db, userId, input.projectId);
  const approvedReferenceAssets: Array<Pick<ReferenceAssetRecord, "id" | "referenceKind" | "originalFilename" | "widthPx" | "heightPx" | "contentHashSha256" | "provenanceDeclaration">> = [];
  for (const id of input.referenceAssetIds) {
    const reference = activeReferences.find((candidate) => candidate.id === id);
    if (!reference) continue;
    try {
      assertReferenceCanBeUsedForGeneration(db, userId, id);
      approvedReferenceAssets.push({ id: reference.id, referenceKind: reference.referenceKind, originalFilename: reference.originalFilename, widthPx: reference.widthPx, heightPx: reference.heightPx, contentHashSha256: reference.contentHashSha256, provenanceDeclaration: reference.provenanceDeclaration });
    } catch {
      // Keep the requested ID in the source snapshot; lint explains why it was excluded from generation inputs.
    }
  }
  const source: PromptSourceSnapshot = { bookProject: projectRow, bookBrief: brief, pagePlan, approvedReferenceAssets, requestedReferenceAssetIds: [...input.referenceAssetIds].sort() };
  return composePrompt({ source, generationModel: clean(input.generationModel), generationEndpoint: clean(input.generationEndpoint), aspectRatio: clean(input.aspectRatio), seed: input.seed, referenceAssetIds: approvedReferenceAssets.map((reference) => reference.id), userEdits: input.userEdits });
}

export function restorePromptVersion(db: AppDatabase, userId: string, promptVersionId: string): PromptVersionRecord {
  const original = getPromptVersionForUser(db, userId, promptVersionId);
  if (!original || !original.pagePlanId) throw new Error("Prompt version not found.");
  const composed = composePrompt({ source: original.sourceFieldSnapshot, generationModel: original.generationModel, generationEndpoint: original.generationEndpoint, aspectRatio: original.aspectRatio, seed: original.seed ?? undefined, referenceAssetIds: original.referenceAssetIds, userEdits: original.userEdits });
  return createPromptVersion(db, userId, composed, { projectId: original.projectId, pagePlanId: original.pagePlanId, generationModel: original.generationModel, generationEndpoint: original.generationEndpoint, aspectRatio: original.aspectRatio, seed: original.seed ?? undefined, referenceAssetIds: original.referenceAssetIds, userEdits: original.userEdits }, original.id);
}
