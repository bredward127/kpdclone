import crypto from "node:crypto";
import type { AppDatabase, ProjectRecord } from "./db";
import { getProjectForUser } from "./db";
import type { PrivateStorage } from "./storage";

export const SPINE_TEXT_MIN_PAGES = 79;
export type CoverBarcodeDecision = "amazon_placed" | "creator_supplied";
export type CoverPlanStatus = "draft" | "needs_template_refresh" | "needs_review" | "approved" | "superseded" | "archived";
export type CoverRect = { x: number; y: number; width: number; height: number };
export type CoverPlacementBox = CoverRect & { surface: "front" | "back" | "spine"; kind: "text" | "art" | "barcode" };
export type CoverPlacementRules = { safeZones: { front: CoverRect; back: CoverRect; spine?: CoverRect }; barcodeZone?: CoverRect; spineTextZone?: CoverRect };
export type CoverPlacementWarning = { code: "outside_safe_zone" | "barcode_exclusion_overlap" | "spine_clearance"; message: string; box: CoverPlacementBox };

function contains(outer: CoverRect, inner: CoverRect): boolean { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function intersects(first: CoverRect, second: CoverRect): boolean { return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y; }

export function validateCoverPlacement(boxes: CoverPlacementBox[], rules: CoverPlacementRules): CoverPlacementWarning[] {
  const warnings: CoverPlacementWarning[] = [];
  for (const box of boxes) {
    const safe = box.surface === "spine" ? rules.safeZones.spine : rules.safeZones[box.surface];
    if (box.kind !== "barcode" && safe && !contains(safe, box)) warnings.push({ code: box.surface === "spine" ? "spine_clearance" : "outside_safe_zone", message: box.surface === "spine" ? "Spine text or artwork crosses the spine safe zone; keep at least 0.0625 in from each spine edge." : `${box.kind === "text" ? "Text" : "Artwork"} crosses the ${box.surface} safe zone and may shift or trim during production.`, box });
    if (box.kind !== "barcode" && box.surface === "back" && rules.barcodeZone && intersects(box, rules.barcodeZone)) warnings.push({ code: "barcode_exclusion_overlap", message: "Back-cover content overlaps the barcode exclusion zone and may prevent a readable barcode.", box });
    if (box.kind === "barcode" && rules.barcodeZone && !contains(rules.barcodeZone, box)) warnings.push({ code: "barcode_exclusion_overlap", message: "The supplied barcode is outside the reserved barcode zone; it may be too close to trim or spine for reliable scanning.", box });
  }
  return warnings;
}

export type CoverPlanInput = {
  binding: "paperback";
  trimWidthInches: number;
  trimHeightInches: number;
  finalInteriorPageCount: number;
  paperSelection: string;
  inkSelection: string;
  readingDirection: "ltr" | "rtl";
  title: string;
  subtitle?: string;
  author: string;
  imprint?: string;
  backCoverCopy?: string;
  barcodeDecision: CoverBarcodeDecision;
  spineTextPermitted: boolean;
  frontArtAssetId?: string;
  backArtAssetId?: string;
  decorativeAssetIds?: string[];
  placement?: Record<string, unknown>;
  templateImportId?: string | null;
  inputsConfirmed?: boolean;
};

export type CoverTemplateSummary = { id: string; sourceUrl: string; retrievedAt: string; calculatorInputsJson: string; guideMimeType: string; guideByteSize: number; fullCoverWidthInches: number; fullCoverHeightInches: number; boundsJson: string; safeZonesJson: string; bleedZonesJson: string; barcodeMarginJson: string; spineSafeZoneJson: string; interiorFingerprint: string; status: "current" | "superseded" | "invalidated"; createdAt: string; updatedAt: string };

export type TemplateImportInput = {
  sourceUrl: string;
  retrievedAt: string;
  calculatorInputs: Record<string, unknown>;
  guideBytes: Uint8Array;
  guideMimeType: "application/pdf" | "image/png";
  fullCoverWidthInches: number;
  fullCoverHeightInches: number;
  bounds: Record<string, unknown>;
  safeZones: Record<string, unknown>;
  bleedZones: Record<string, unknown>;
  barcodeMargin: Record<string, unknown>;
  spineSafeZone: Record<string, unknown>;
  interiorFingerprint: string;
};

export type CoverPlanVersion = CoverPlanInput & {
  id: string;
  userId: string;
  projectId: string;
  version: number;
  subtitle: string;
  imprint: string;
  backCoverCopy: string;
  decorativeAssetIds: string[];
  frontArtPrompt: string;
  backArtPrompt: string;
  decorativeArtPrompt: string;
  placement: Record<string, unknown>;
  templateImportId: string | null;
  interiorFingerprint: string;
  inputsConfirmed: boolean;
  status: CoverPlanStatus;
  createdAt: string;
  updatedAt: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

export function makeInteriorFingerprint(project: ProjectRecord, finalPageCount = project.pageCount): string {
  return crypto.createHash("sha256").update(stableJson({ pageCount: finalPageCount, trimWidthInches: project.trimWidthInches, trimHeightInches: project.trimHeightInches, paperSelection: project.paperSelection, inkSelection: project.inkSelection, readingDirection: project.readingDirection })).digest("hex");
}

export function coverArtPrompt(role: "front" | "back" | "decorative", brief: string): string {
  const roleText = role === "front" ? "front-cover focal artwork" : role === "back" ? "optional back-cover background or artwork" : "optional decorative cover element";
  return `${roleText}. ${brief.trim()} Create artwork only. Do not render readable cover text, title, subtitle, author name, imprint, barcode, QR code, ISBN, or spine lettering. Leave final typography and barcode placement to the deterministic cover compositor.`;
}

export function assertSpineTextAllowed(pageCount: number, spineTextPermitted: boolean): void {
  if (spineTextPermitted && pageCount < SPINE_TEXT_MIN_PAGES) throw new Error(`Spine text requires at least ${SPINE_TEXT_MIN_PAGES} interior pages; this plan has ${pageCount}.`);
}

export function invalidateCoverPlansForInteriorChange(db: AppDatabase, userId: string, projectId: string, currentFingerprint: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE cover_plan_versions SET status = 'needs_template_refresh', inputs_confirmed = 0, updated_at = ? WHERE user_id = ? AND project_id = ? AND interior_fingerprint != ? AND status NOT IN ('superseded', 'archived')`).run(now, userId, projectId, currentFingerprint);
  db.prepare(`UPDATE cover_template_imports SET status = 'invalidated', updated_at = ? WHERE user_id = ? AND project_id = ? AND interior_fingerprint != ? AND status = 'current'`).run(now, userId, projectId, currentFingerprint);
  return result.changes;
}

export async function importCoverTemplate(db: AppDatabase, storage: PrivateStorage, userId: string, projectId: string, input: TemplateImportInput) {
  if (!getProjectForUser(db, userId, projectId)) throw new Error("Project not found.");
  let url: URL;
  try { url = new URL(input.sourceUrl); } catch { throw new Error("Template source URL must be valid."); }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Template source URL must use HTTP(S).");
  if (!input.guideBytes.byteLength) throw new Error("Template guide asset is empty.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storageReference = `${userId}/projects/${projectId}/cover-templates/${id}.${input.guideMimeType === "application/pdf" ? "pdf" : "png"}`;
  await storage.put(storageReference, input.guideBytes, input.guideMimeType);
  try {
    db.transaction(() => {
      db.prepare(`UPDATE cover_template_imports SET status = 'superseded', updated_at = ? WHERE user_id = ? AND project_id = ? AND status = 'current'`).run(now, userId, projectId);
      db.prepare(`INSERT INTO cover_template_imports (id, user_id, project_id, source_url, retrieved_at, calculator_inputs_json, guide_storage_reference, guide_mime_type, guide_byte_size, full_cover_width_inches, full_cover_height_inches, bounds_json, safe_zones_json, bleed_zones_json, barcode_margin_json, spine_safe_zone_json, interior_fingerprint, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?)`).run(id, userId, projectId, input.sourceUrl, input.retrievedAt, JSON.stringify(input.calculatorInputs), storageReference, input.guideMimeType, input.guideBytes.byteLength, input.fullCoverWidthInches, input.fullCoverHeightInches, JSON.stringify(input.bounds), JSON.stringify(input.safeZones), JSON.stringify(input.bleedZones), JSON.stringify(input.barcodeMargin), JSON.stringify(input.spineSafeZone), input.interiorFingerprint, now, now);
    })();
  } catch (error) {
    await storage.delete(storageReference).catch(() => undefined);
    throw error;
  }
  return { id, projectId, sourceUrl: input.sourceUrl, retrievedAt: input.retrievedAt, interiorFingerprint: input.interiorFingerprint, guideMimeType: input.guideMimeType, guideByteSize: input.guideBytes.byteLength, storageReference };
}

export function createCoverPlanVersion(db: AppDatabase, userId: string, projectId: string, input: CoverPlanInput): CoverPlanVersion {
  const project = getProjectForUser(db, userId, projectId);
  if (!project) throw new Error("Project not found.");
  assertSpineTextAllowed(input.finalInteriorPageCount, input.spineTextPermitted);
  if (input.inputsConfirmed && !input.templateImportId) throw new Error("A current imported KDP template is required before confirming cover inputs.");
  const fingerprint = makeInteriorFingerprint(project, input.finalInteriorPageCount);
  if (input.templateImportId) {
    const template = db.prepare(`SELECT interior_fingerprint AS interiorFingerprint, status FROM cover_template_imports WHERE user_id = ? AND id = ? AND project_id = ?`).get(userId, input.templateImportId, projectId) as { interiorFingerprint: string; status: string } | undefined;
    if (!template) throw new Error("Cover template import not found.");
    if (template.status !== "current" || template.interiorFingerprint !== fingerprint) throw new Error("This cover template is stale. Refresh it using the finalized interior inputs before confirming the cover plan.");
  }
  const existing = db.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM cover_plan_versions WHERE user_id = ? AND project_id = ?`).get(userId, projectId) as { version: number };
  const version = Number(existing.version) + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const selectedAssets = [{ role: "front_focal_art", id: input.frontArtAssetId }, { role: "back_background_art", id: input.backArtAssetId }, ...(input.decorativeAssetIds ?? []).map((id) => ({ role: "decorative_element", id }))].filter((item): item is { role: "front_focal_art" | "back_background_art" | "decorative_element"; id: string } => Boolean(item.id));
  for (const asset of selectedAssets) {
    const owned = db.prepare(`SELECT 'generated' AS kind FROM generated_assets WHERE user_id = ? AND project_id = ? AND id = ? UNION ALL SELECT 'reference' AS kind FROM reference_assets WHERE user_id = ? AND project_id = ? AND id = ? LIMIT 1`).get(userId, projectId, asset.id, userId, projectId, asset.id) as { kind: "generated" | "reference" } | undefined;
    if (!owned) throw new Error(`Cover art asset ${asset.id} is unavailable in this project.`);
  }
  const frontArtPrompt = coverArtPrompt("front", "Original focal artwork that supports the book’s visual continuity.");
  const backArtPrompt = coverArtPrompt("back", "Original supporting artwork with open space for deterministic back-cover copy.");
  const decorativeArtPrompt = coverArtPrompt("decorative", "Original non-typographic motifs or small decorative elements.");
  db.transaction(() => {
    db.prepare(`UPDATE cover_plan_versions SET status = 'superseded', updated_at = ? WHERE user_id = ? AND project_id = ? AND status NOT IN ('archived', 'superseded')`).run(now, userId, projectId);
    db.prepare(`INSERT INTO cover_plan_versions (id, user_id, project_id, version, binding, trim_width_inches, trim_height_inches, final_interior_page_count, paper_selection, ink_selection, reading_direction, title, subtitle, author, imprint, back_cover_copy, barcode_decision, spine_text_permitted, front_art_asset_id, back_art_asset_id, decorative_asset_ids_json, front_art_prompt, back_art_prompt, decorative_art_prompt, placement_json, template_import_id, interior_fingerprint, inputs_confirmed, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, projectId, version, input.binding, input.trimWidthInches, input.trimHeightInches, input.finalInteriorPageCount, input.paperSelection, input.inkSelection, input.readingDirection, input.title, input.subtitle ?? "", input.author, input.imprint ?? "", input.backCoverCopy ?? "", input.barcodeDecision, input.spineTextPermitted ? 1 : 0, null, null, JSON.stringify(input.decorativeAssetIds ?? []), frontArtPrompt, backArtPrompt, decorativeArtPrompt, JSON.stringify(input.placement ?? {}), input.templateImportId ?? null, fingerprint, input.inputsConfirmed ? 1 : 0, input.inputsConfirmed ? "needs_review" : "draft", now, now);
    for (const asset of selectedAssets) {
      const generated = db.prepare(`SELECT id FROM generated_assets WHERE user_id = ? AND project_id = ? AND id = ?`).get(userId, projectId, asset.id) as { id: string } | undefined;
      db.prepare(`INSERT INTO cover_plan_assets (id, user_id, project_id, cover_plan_version_id, role, generated_asset_id, reference_asset_id, placement_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`).run(crypto.randomUUID(), userId, projectId, id, asset.role, generated?.id ?? null, generated ? null : asset.id, now);
    }
  })();
  return getCoverPlanVersion(db, userId, id)!;
}

export function getCoverPlanVersion(db: AppDatabase, userId: string, id: string): CoverPlanVersion | null {
  const row = db.prepare(`SELECT * FROM cover_plan_versions WHERE user_id = ? AND id = ?`).get(userId, id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const plan = parseCoverPlan(row);
  const roleRows = db.prepare(`SELECT role, COALESCE(generated_asset_id, reference_asset_id) AS assetId FROM cover_plan_assets WHERE user_id = ? AND cover_plan_version_id = ?`).all(userId, id) as Array<{ role: string; assetId: string }>;
  plan.frontArtAssetId = roleRows.find((item) => item.role === "front_focal_art")?.assetId;
  plan.backArtAssetId = roleRows.find((item) => item.role === "back_background_art")?.assetId;
  plan.decorativeAssetIds = roleRows.filter((item) => item.role === "decorative_element").map((item) => item.assetId);
  return plan;
}

export function getLatestCoverPlan(db: AppDatabase, userId: string, projectId: string): CoverPlanVersion | null {
  const row = db.prepare(`SELECT id FROM cover_plan_versions WHERE user_id = ? AND project_id = ? ORDER BY version DESC LIMIT 1`).get(userId, projectId) as { id: string } | undefined;
  return row ? getCoverPlanVersion(db, userId, row.id) : null;
}

export function listCoverTemplates(db: AppDatabase, userId: string, projectId: string): CoverTemplateSummary[] {
  return db.prepare(`SELECT id, source_url AS sourceUrl, retrieved_at AS retrievedAt, calculator_inputs_json AS calculatorInputsJson, guide_mime_type AS guideMimeType, guide_byte_size AS guideByteSize, full_cover_width_inches AS fullCoverWidthInches, full_cover_height_inches AS fullCoverHeightInches, bounds_json AS boundsJson, safe_zones_json AS safeZonesJson, bleed_zones_json AS bleedZonesJson, barcode_margin_json AS barcodeMarginJson, spine_safe_zone_json AS spineSafeZoneJson, interior_fingerprint AS interiorFingerprint, status, created_at AS createdAt, updated_at AS updatedAt FROM cover_template_imports WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC`).all(userId, projectId) as CoverTemplateSummary[];
}

function parseCoverPlan(row: Record<string, unknown>): CoverPlanVersion {
  return { id: String(row.id), userId: String(row.user_id), projectId: String(row.project_id), version: Number(row.version), binding: row.binding as "paperback", trimWidthInches: Number(row.trim_width_inches), trimHeightInches: Number(row.trim_height_inches), finalInteriorPageCount: Number(row.final_interior_page_count), paperSelection: String(row.paper_selection), inkSelection: String(row.ink_selection), readingDirection: row.reading_direction as "ltr" | "rtl", title: String(row.title), subtitle: String(row.subtitle), author: String(row.author), imprint: String(row.imprint), backCoverCopy: String(row.back_cover_copy), barcodeDecision: row.barcode_decision as CoverBarcodeDecision, spineTextPermitted: Boolean(row.spine_text_permitted), frontArtAssetId: row.front_art_asset_id ? String(row.front_art_asset_id) : undefined, backArtAssetId: row.back_art_asset_id ? String(row.back_art_asset_id) : undefined, decorativeAssetIds: JSON.parse(String(row.decorative_asset_ids_json ?? "[]")), frontArtPrompt: String(row.front_art_prompt), backArtPrompt: String(row.back_art_prompt), decorativeArtPrompt: String(row.decorative_art_prompt), placement: JSON.parse(String(row.placement_json ?? "{}")), templateImportId: row.template_import_id ? String(row.template_import_id) : null, interiorFingerprint: String(row.interior_fingerprint), inputsConfirmed: Boolean(row.inputs_confirmed), status: row.status as CoverPlanStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
