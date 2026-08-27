import crypto from "node:crypto";
import sharp, { type Metadata, type Stats } from "sharp";
import type { AppDatabase } from "./db";
import { getProjectForUser } from "./db";

export const QUALITY_ANALYSIS_VERSION = "asset-quality-v1";
export type QualitySeverity = "blocking" | "warning";
export type QualityIssue = { code: string; severity: QualitySeverity; message: string; details: Record<string, unknown> };
export type QualityResult = {
  id: string;
  userId: string;
  projectId: string;
  generatedAssetId: string | null;
  referenceAssetId: string | null;
  sourceChecksumSha256: string;
  analysisVersion: string;
  placedWidthInches: number;
  placedHeightInches: number;
  bleedInches: number;
  safeAreaInsetInches: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  effectiveDpi: number;
  blockingIssueCount: number;
  warningCount: number;
  overallStatus: "blocked" | "warnings" | "pass" | "needs_human_review";
  metrics: Record<string, unknown>;
  issues: QualityIssue[];
  humanApprovalRequired: true;
  createdAt: string;
  updatedAt: string;
};

export type QualityInput = {
  userId: string;
  projectId: string;
  generatedAssetId?: string;
  referenceAssetId?: string;
  checksumSha256: string;
  bytes: Uint8Array;
  declaredMimeType: string;
  placedWidthInches?: number;
  placedHeightInches?: number;
  bleedInches?: number;
  safeAreaInsetInches?: number;
  allowAlpha?: boolean;
  coloringBook?: boolean;
};

function round(value: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function addIssue(issues: QualityIssue[], code: string, severity: QualitySeverity, message: string, details: Record<string, unknown> = {}): void {
  issues.push({ code, severity, message, details });
}

export async function analyzeAssetQuality(db: AppDatabase, input: QualityInput): Promise<QualityResult> {
  if (Boolean(input.generatedAssetId) === Boolean(input.referenceAssetId)) throw new Error("Quality analysis must identify exactly one generated or reference asset.");
  const project = getProjectForUser(db, input.userId, input.projectId);
  if (!project) throw new Error("Project not found.");
  const placedWidthInches = input.placedWidthInches ?? project.trimWidthInches;
  const placedHeightInches = input.placedHeightInches ?? project.trimHeightInches;
  const bleedInches = input.bleedInches ?? (project.bleedPreference === "bleed" ? 0.125 : 0);
  const safeAreaInsetInches = input.safeAreaInsetInches ?? (project.bleedPreference === "bleed" ? 0.25 : 0.125);
  const requiredWidthPx = Math.ceil(placedWidthInches * 300);
  const requiredHeightPx = Math.ceil(placedHeightInches * 300);
  const issues: QualityIssue[] = [];
  const metrics: Record<string, unknown> = { declaredMimeType: input.declaredMimeType, requiredWidthPx, requiredHeightPx, targetDpi: 300, analysisVersion: QUALITY_ANALYSIS_VERSION };
  let metadata: Metadata;
  let stats: Stats;
  try {
    const image = sharp(input.bytes, { limitInputPixels: 25_000_000, failOn: "error" });
    [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  } catch {
    addIssue(issues, "corrupted_file", "blocking", "The image could not be decoded safely; upload or generation result is corrupted or unsupported.");
    return persistQualityResult(db, input, { placedWidthInches, placedHeightInches, bleedInches, safeAreaInsetInches, requiredWidthPx, requiredHeightPx, effectiveDpi: 0, metrics, issues });
  }
  const widthPx = metadata.width ?? 0;
  const heightPx = metadata.height ?? 0;
  metrics.widthPx = widthPx; metrics.heightPx = heightPx; metrics.hasAlpha = Boolean(metadata.hasAlpha); metrics.format = metadata.format ?? null;
  if (!widthPx || !heightPx) addIssue(issues, "invalid_dimensions", "blocking", "The image has no valid pixel dimensions.");
  const effectiveDpi = widthPx && heightPx ? Math.min(widthPx / placedWidthInches, heightPx / placedHeightInches) : 0;
  metrics.effectiveDpi = round(effectiveDpi);
  if (effectiveDpi < 300) addIssue(issues, "effective_dpi_below_300", "blocking", `This asset is ${round(effectiveDpi)} effective DPI. It requires at least ${requiredWidthPx} × ${requiredHeightPx}px for a ${placedWidthInches} × ${placedHeightInches}-inch placed image at 300 DPI.`, { effectiveDpi: round(effectiveDpi), requiredWidthPx, requiredHeightPx, placedWidthInches, placedHeightInches });
  const expectedRatio = placedWidthInches / placedHeightInches;
  const actualRatio = widthPx && heightPx ? widthPx / heightPx : 0;
  if (actualRatio && Math.abs(actualRatio / expectedRatio - 1) > 0.15) addIssue(issues, "extreme_aspect_ratio_mismatch", "blocking", `The image ratio ${round(actualRatio)} is too far from the intended placed ratio ${round(expectedRatio)}; reposition or replace the asset before export.`, { actualRatio: round(actualRatio), expectedRatio: round(expectedRatio) });
  if (metadata.hasAlpha && input.allowAlpha === false) addIssue(issues, "unexpected_alpha", "blocking", "This print workflow forbids transparency, but the asset contains an alpha channel.", { allowAlpha: false });
  const channelMeans = stats.channels.map((channel: { mean: number }) => round(channel.mean));
  const channelStdev = stats.channels.map((channel: { stdev: number }) => round(channel.stdev));
  metrics.channelMeans = channelMeans; metrics.channelStdev = channelStdev;
  const averageStdev = channelStdev.reduce((sum: number, value: number) => sum + value, 0) / Math.max(channelStdev.length, 1);
  if (averageStdev < 2) addIssue(issues, "near_blank", "blocking", "The image is blank or near-blank based on deterministic pixel variance; review the source before approval.", { averageChannelStdev: round(averageStdev) });
  const duplicate = db.prepare(`SELECT id FROM generated_assets WHERE user_id = ? AND project_id = ? AND checksum_sha256 = ? AND id != COALESCE(?, '') UNION ALL SELECT id FROM reference_assets WHERE user_id = ? AND project_id = ? AND content_hash_sha256 = ? AND id != COALESCE(?, '') LIMIT 1`).get(input.userId, input.projectId, input.checksumSha256, input.generatedAssetId ?? null, input.userId, input.projectId, input.checksumSha256, input.referenceAssetId ?? null) as { id: string } | undefined;
  if (duplicate) addIssue(issues, "duplicate_asset_hash", "warning", "Another asset in this project has the same content hash; retain only the intended copy before export.", { duplicateAssetId: duplicate.id });
  if (input.coloringBook) {
    const chromaSpread = channelMeans.length >= 3 ? Math.max(...channelMeans.slice(0, 3)) - Math.min(...channelMeans.slice(0, 3)) : 0;
    if (averageStdev < 12) addIssue(issues, "coloring_line_contrast", "warning", "Line contrast may be too subtle for a coloring-book workflow; human review is required.", { averageChannelStdev: round(averageStdev), suggestedMinimum: 12 });
    if (chromaSpread > 18 || channelStdev.length > 1 && averageStdev > 70) addIssue(issues, "coloring_tonal_color_content", "warning", "The image may contain excessive tonal or color content for a coloring-book workflow; human review is required.", { chromaSpread: round(chromaSpread), averageChannelStdev: round(averageStdev) });
    if (averageStdev > 55) addIssue(issues, "coloring_detail_density", "warning", "High pixel variation may indicate details that are too dense for comfortable coloring; human review is required.", { averageChannelStdev: round(averageStdev) });
  }
  return persistQualityResult(db, input, { placedWidthInches, placedHeightInches, bleedInches, safeAreaInsetInches, requiredWidthPx, requiredHeightPx, effectiveDpi, metrics, issues });
}

function persistQualityResult(db: AppDatabase, input: QualityInput, values: Omit<QualityResult, "id" | "userId" | "projectId" | "generatedAssetId" | "referenceAssetId" | "sourceChecksumSha256" | "analysisVersion" | "humanApprovalRequired" | "createdAt" | "updatedAt" | "blockingIssueCount" | "warningCount" | "overallStatus">): QualityResult {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const blockingIssueCount = values.issues.filter((issue) => issue.severity === "blocking").length;
  const warningCount = values.issues.filter((issue) => issue.severity === "warning").length;
  const overallStatus = blockingIssueCount ? "blocked" : warningCount ? "warnings" : "needs_human_review";
  const identityColumn = input.generatedAssetId ? "generated_asset_id" : "reference_asset_id";
  const identityValue = input.generatedAssetId ?? input.referenceAssetId;
  db.prepare(`DELETE FROM asset_quality_results WHERE user_id = ? AND ${identityColumn} = ?`).run(input.userId, identityValue);
  db.prepare(`INSERT INTO asset_quality_results
    (id, user_id, project_id, generated_asset_id, reference_asset_id, source_checksum_sha256, analysis_version,
     placed_width_inches, placed_height_inches, bleed_inches, safe_area_inset_inches, required_width_px, required_height_px,
     effective_dpi, blocking_issue_count, warning_count, overall_status, metrics_json, issues_json, human_approval_required, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
    id, input.userId, input.projectId, input.generatedAssetId ?? null, input.referenceAssetId ?? null, input.checksumSha256, QUALITY_ANALYSIS_VERSION,
    values.placedWidthInches, values.placedHeightInches, values.bleedInches, values.safeAreaInsetInches, values.requiredWidthPx, values.requiredHeightPx,
    values.effectiveDpi, blockingIssueCount, warningCount, overallStatus, JSON.stringify(values.metrics), JSON.stringify(values.issues), now, now,
  );
  const row = db.prepare(`SELECT * FROM asset_quality_results WHERE user_id = ? AND ((generated_asset_id = ? AND ? IS NOT NULL) OR (reference_asset_id = ? AND ? IS NOT NULL)) ORDER BY updated_at DESC LIMIT 1`).get(input.userId, input.generatedAssetId ?? null, input.generatedAssetId ?? null, input.referenceAssetId ?? null, input.referenceAssetId ?? null) as Record<string, unknown>;
  return parseQualityResult(row);
}

export function parseQualityResult(row: Record<string, unknown>): QualityResult {
  return {
    id: String(row.id), userId: String(row.user_id), projectId: String(row.project_id), generatedAssetId: row.generated_asset_id ? String(row.generated_asset_id) : null, referenceAssetId: row.reference_asset_id ? String(row.reference_asset_id) : null, sourceChecksumSha256: String(row.source_checksum_sha256), analysisVersion: String(row.analysis_version), placedWidthInches: Number(row.placed_width_inches), placedHeightInches: Number(row.placed_height_inches), bleedInches: Number(row.bleed_inches), safeAreaInsetInches: Number(row.safe_area_inset_inches), requiredWidthPx: Number(row.required_width_px), requiredHeightPx: Number(row.required_height_px), effectiveDpi: Number(row.effective_dpi), blockingIssueCount: Number(row.blocking_issue_count), warningCount: Number(row.warning_count), overallStatus: row.overall_status as QualityResult["overallStatus"], metrics: JSON.parse(String(row.metrics_json ?? "{}")), issues: JSON.parse(String(row.issues_json ?? "[]")), humanApprovalRequired: true, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function getQualityResultForAsset(db: AppDatabase, userId: string, assetId: string, kind: "generated" | "reference"): QualityResult | null {
  const column = kind === "generated" ? "generated_asset_id" : "reference_asset_id";
  const row = db.prepare(`SELECT * FROM asset_quality_results WHERE user_id = ? AND ${column} = ? ORDER BY updated_at DESC LIMIT 1`).get(userId, assetId) as Record<string, unknown> | undefined;
  return row ? parseQualityResult(row) : null;
}
