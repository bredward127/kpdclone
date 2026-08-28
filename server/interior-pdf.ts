import crypto from "node:crypto";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { AppDatabase, ProjectRecord } from "./db";
import { getProjectForUser } from "./db";
import { readPrivateStorageBytes, type PrivateStorage } from "./storage";
import { getQualityResultForAsset } from "./asset-quality";
import {
  KDP_BLEED_ALLOWANCE,
  bleedHeightAllowanceInches,
  bleedWidthAllowanceInches,
  gutterMarginInches,
  interiorPageSizeInches,
  outsideMarginInches,
  topBottomMarginInches,
} from "../shared/kdp-geometry";

export const INTERIOR_RULESET_VERSION = "kdp-paperback-2026-02";
export const INTERIOR_BLEED_INCHES = KDP_BLEED_ALLOWANCE.outsideInches;
const POINTS_PER_INCH = 72;

export type InteriorPageType = "front_matter" | "dedication" | "copyright" | "storybook_text_spread" | "coloring_page" | "activity_page" | "intentional_blank" | "end_matter";
export type ReadingDirection = "ltr" | "rtl";
export type TextBlock = { id: string; text: string; x: number; y: number; width: number; height: number; fontSize: number; fontId?: string; align?: "left" | "center" | "right" };
export type ImagePlacement = { x: number; y: number; width: number; height: number; fit?: "contain" | "cover" };
export type InteriorPageInput = { id: string; pageNumber: number; pageType: InteriorPageType; assetId?: string; assetVersion?: string; assetChecksumSha256?: string; assetStatus?: "approved" | "needs_review" | "rejected" | "missing"; assetBytes?: Uint8Array; assetMimeType?: "image/png" | "image/jpeg"; assetQualityBlockingIssues?: number; textBlocks?: TextBlock[]; imagePlacement?: ImagePlacement; intentionallyBlank?: boolean; layoutId?: string };
export type InteriorFont = { id: string; family: string; bytes: Uint8Array; permitted: boolean };
export type InteriorBuildInput = { projectId: string; trimWidthInches: number; trimHeightInches: number; bleed: boolean; pageCount: number; paperSelection: string; inkSelection: string; readingDirection: ReadingDirection; pages: InteriorPageInput[]; fonts: InteriorFont[]; includeEndMatter?: boolean; autoPadOddPageCount?: boolean };
export type KdpInteriorRules = { version: string; insideMarginInches: number; outsideMarginInches: number; topMarginInches: number; bottomMarginInches: number; bleedWidthInches: number; bleedHeightInches: number };
export type PreflightIssue = { code: string; severity: "blocking" | "warning"; pageId?: string; pageNumber?: number; message: string; details?: Record<string, unknown> };
export type InteriorPreflightReport = { rulesetVersion: string; requestedPageCount: number; finalPageCount: number; issues: PreflightIssue[]; blockingIssueCount: number; warningCount: number; passed: boolean };
export type LayoutManifest = { manifestVersion: "interior-layout-v1"; rulesetVersion: string; projectId: string; physicalPageSizeInches: { width: number; height: number }; trimSizeInches: { width: number; height: number }; bleed: boolean; readingDirection: ReadingDirection; pageCount: number; pages: Array<Record<string, unknown>>; fonts: Array<{ id: string; family: string; embedded: boolean }>; preflight: { blockingIssueCount: number; warningCount: number }; };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
function inches(value: number): number { return value * POINTS_PER_INCH; }
function approxEqual(a: number, b: number): boolean { return Math.abs(a - b) < 0.0001; }

export function kdpInteriorRules(pageCount: number, bleed: boolean): KdpInteriorRules {
  return {
    version: INTERIOR_RULESET_VERSION,
    insideMarginInches: gutterMarginInches(pageCount),
    outsideMarginInches: outsideMarginInches(bleed),
    topMarginInches: topBottomMarginInches(bleed),
    bottomMarginInches: topBottomMarginInches(bleed),
    bleedWidthInches: bleedWidthAllowanceInches(bleed),
    bleedHeightInches: bleedHeightAllowanceInches(bleed),
  };
}

export function interiorPhysicalSize(trimWidthInches: number, trimHeightInches: number, bleed: boolean): { width: number; height: number } {
  return interiorPageSizeInches(trimWidthInches, trimHeightInches, bleed);
}

function pageSide(pageNumber: number, readingDirection: ReadingDirection): "left" | "right" { const ltrSide = pageNumber % 2 === 0 ? "left" : "right"; return readingDirection === "ltr" ? ltrSide : ltrSide === "left" ? "right" : "left"; }

export function preflightInterior(input: InteriorBuildInput): InteriorPreflightReport {
  const rules = kdpInteriorRules(input.pageCount, input.bleed);
  const issues: PreflightIssue[] = [];
  const ordered = [...input.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const seenNumbers = new Set<number>();
  let blankRun = 0;
  for (const page of ordered) {
    if (seenNumbers.has(page.pageNumber)) issues.push({ code: "duplicate_page_number", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: `Page number ${page.pageNumber} is repeated in the ordered page list.` });
    seenNumbers.add(page.pageNumber);
    const blank = page.pageType === "intentional_blank" || page.intentionallyBlank === true;
    blankRun = blank ? blankRun + 1 : 0;
    if (blankRun >= 3) issues.push({ code: "long_blank_page_run", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "Three or more consecutive blank pages require intentional editorial review before export." });
    if (page.pageType === "coloring_page" && (!page.assetId || page.assetStatus !== "approved")) issues.push({ code: "unapproved_coloring_asset", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "A coloring page must reference an approved asset before interior export." });
    if (page.assetId && page.assetStatus !== "approved") issues.push({ code: "unapproved_asset", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "Interior export accepts only approved assets; this asset is not approved.", details: { assetId: page.assetId, assetStatus: page.assetStatus ?? "missing" } });
    if (page.assetId && !page.assetBytes) issues.push({ code: "missing_asset_bytes", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "The approved source asset could not be resolved from private storage." });
    if ((page.assetQualityBlockingIssues ?? 0) > 0) issues.push({ code: "asset_quality_blocked", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "The approved asset has unresolved blocking quality issues and cannot be exported.", details: { blockingIssueCount: page.assetQualityBlockingIssues } });
    if (!blank && !page.assetId && !page.textBlocks?.length) issues.push({ code: "missing_page_content", severity: "blocking", pageId: page.id, pageNumber: page.pageNumber, message: "This non-blank page has neither an approved asset nor creator-entered content." });
    for (const block of page.textBlocks ?? []) {
      const contentLeft = rules.outsideMarginInches;
      const contentRight = input.trimWidthInches - rules.outsideMarginInches;
      const contentTop = input.trimHeightInches - rules.topMarginInches;
      const contentBottom = rules.bottomMarginInches;
      const inside = pageSide(page.pageNumber, input.readingDirection) === "left" ? rules.insideMarginInches : rules.outsideMarginInches;
      const safeLeft = pageSide(page.pageNumber, input.readingDirection) === "left" ? inside : contentLeft;
      const safeRight = pageSide(page.pageNumber, input.readingDirection) === "left" ? contentRight : input.trimWidthInches - inside;
      if (block.x < safeLeft || block.x + block.width > safeRight || block.y < contentBottom || block.y + block.height > contentTop) issues.push({ code: "margin_warning", severity: "warning", pageId: page.id, pageNumber: page.pageNumber, message: `Text block ${block.id} crosses the active safe margin for this ${pageSide(page.pageNumber, input.readingDirection)} page.`, details: { safeLeft, safeRight, contentBottom, contentTop } });
    }
  }
  if (input.pageCount % 2 === 1 && input.autoPadOddPageCount !== false) issues.push({ code: "odd_page_count_padded", severity: "warning", message: "The requested odd page count will receive one intentional blank page so the final paperback interior has an even page count." });
  const finalPageCount = input.pageCount % 2 === 1 && input.autoPadOddPageCount !== false ? input.pageCount + 1 : input.pageCount;
  const allowedBeforePadding = input.pageCount % 2 === 1 && input.autoPadOddPageCount !== false ? input.pageCount : finalPageCount;
  if (ordered.length !== allowedBeforePadding && ordered.length !== finalPageCount) issues.push({ code: "page_count_mismatch", severity: "blocking", message: `The ordered page list contains ${ordered.length} pages but the final interior requires ${finalPageCount}.`, details: { requestedPageCount: input.pageCount, finalPageCount, orderedPageCount: ordered.length } });
  for (let index = 0; index < ordered.length; index += 1) {
    const expected = index + 1;
    if (ordered[index].pageNumber !== expected) issues.push({ code: "non_sequential_pagination", severity: "blocking", pageId: ordered[index].id, pageNumber: ordered[index].pageNumber, message: `Page list position ${index + 1} must be physical page ${expected}.` });
  }
  const blockingIssueCount = issues.filter((issue) => issue.severity === "blocking").length;
  return { rulesetVersion: rules.version, requestedPageCount: input.pageCount, finalPageCount, issues, blockingIssueCount, warningCount: issues.length - blockingIssueCount, passed: blockingIssueCount === 0 };
}

function imagePlacementFor(page: InteriorPageInput, input: InteriorBuildInput): ImagePlacement { return page.imagePlacement ?? { x: 0, y: 0, width: input.trimWidthInches, height: input.trimHeightInches, fit: "cover" }; }
function drawImageFit(target: PDFPage, image: PDFImage, placement: ImagePlacement): void { const box = { x: inches(placement.x), y: inches(placement.y), width: inches(placement.width), height: inches(placement.height) }; target.drawImage(image, box); }
function drawText(target: PDFPage, font: PDFFont, block: TextBlock): void { const color = rgb(0.08, 0.11, 0.14); const lines = block.text.split("\n"); const lineHeight = block.fontSize * 1.25; lines.forEach((line, index) => { let x = inches(block.x); if (block.align === "center") x += inches(block.width) / 2 - font.widthOfTextAtSize(line, block.fontSize) / 2; if (block.align === "right") x += inches(block.width) - font.widthOfTextAtSize(line, block.fontSize); target.drawText(line, { x, y: inches(block.y + block.height) - inches(0.02) - lineHeight * (index + 1), size: block.fontSize, font, color, maxWidth: inches(block.width) }); }); }

export async function assembleInteriorPdf(input: InteriorBuildInput, preview = false): Promise<{ pdfBytes: Uint8Array; manifest: LayoutManifest; preflight: InteriorPreflightReport; manifestBytes: Uint8Array; preflightBytes: Uint8Array }> {
  const normalizedPages = [...input.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const preflight = preflightInterior({ ...input, pages: normalizedPages });
  const finalPages = [...normalizedPages];
  if (input.pageCount % 2 === 1 && input.autoPadOddPageCount !== false && finalPages.length === input.pageCount) finalPages.push({ id: `auto-blank-${input.pageCount + 1}`, pageNumber: input.pageCount + 1, pageType: "intentional_blank", intentionallyBlank: true });
  const physical = interiorPhysicalSize(input.trimWidthInches, input.trimHeightInches, input.bleed);
  const manifest: LayoutManifest = { manifestVersion: "interior-layout-v1", rulesetVersion: INTERIOR_RULESET_VERSION, projectId: input.projectId, physicalPageSizeInches: physical, trimSizeInches: { width: input.trimWidthInches, height: input.trimHeightInches }, bleed: input.bleed, readingDirection: input.readingDirection, pageCount: finalPages.length, pages: finalPages.map((page) => ({ id: page.id, pageNumber: page.pageNumber, side: pageSide(page.pageNumber, input.readingDirection), pageType: page.pageType, assetId: page.assetId ?? null, assetVersion: page.assetVersion ?? null, assetChecksumSha256: page.assetChecksumSha256 ?? null, imagePlacement: page.imagePlacement ?? null, textBlocks: page.textBlocks ?? [], layoutId: page.layoutId ?? null })), fonts: input.fonts.map((font) => ({ id: font.id, family: font.family, embedded: font.permitted })), preflight: { blockingIssueCount: preflight.blockingIssueCount, warningCount: preflight.warningCount } };
  const manifestBytes = Buffer.from(stableJson(manifest));
  const preflightBytes = Buffer.from(stableJson(preflight));
  if (!preflight.passed && !preview) return { pdfBytes: new Uint8Array(), manifest, preflight, manifestBytes, preflightBytes };
  const pdf = await PDFDocument.create();
  pdf.setTitle(preview ? `${input.projectId} interior preview` : `${input.projectId} interior`); pdf.setAuthor("KDP Kids Book Studio"); pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  pdf.registerFontkit(fontkit);
  const fontMap = new Map<string, PDFFont>();
  for (const font of input.fonts) { if (!font.permitted) continue; fontMap.set(font.id, await pdf.embedFont(font.bytes, { subset: false })); }
  if (!fontMap.size && finalPages.some((page) => page.textBlocks?.length)) fontMap.set("standard", await pdf.embedFont(StandardFonts.Helvetica));
  for (const page of finalPages) {
    const target = pdf.addPage([inches(physical.width), inches(physical.height)]);
    if (preview) target.drawText("PREVIEW — NOT FOR UPLOAD", { x: inches(0.2), y: inches(physical.height - 0.18), size: 8, font: fontMap.get("standard") ?? await pdf.embedFont(StandardFonts.Helvetica), color: rgb(0.65, 0.16, 0.1) });
    if (page.assetBytes && page.assetMimeType) { const image = page.assetMimeType === "image/png" ? await pdf.embedPng(page.assetBytes) : await pdf.embedJpg(page.assetBytes); drawImageFit(target, image, imagePlacementFor(page, input)); }
    for (const block of page.textBlocks ?? []) { const font = fontMap.get(block.fontId ?? "standard") ?? fontMap.values().next().value; if (font) drawText(target, font, block); }
  }
  return { pdfBytes: await pdf.save({ useObjectStreams: false, addDefaultPage: false }), manifest, preflight, manifestBytes, preflightBytes };
}

export async function assembleInteriorExport(db: AppDatabase, storage: PrivateStorage, userId: string, input: Omit<InteriorBuildInput, "pages" | "fonts"> & { pages: Array<Omit<InteriorPageInput, "assetBytes" | "assetStatus" | "assetQualityBlockingIssues" | "assetMimeType"> & { assetKind?: "generated"; fontId?: string }>; fonts?: InteriorFont[] }): Promise<{ runId: string; status: "blocked" | "completed"; finalPdfAccessUrl: string | null; previewPdfAccessUrl: string; manifestAccessUrl: string; preflightAccessUrl: string; preflight: InteriorPreflightReport }> {
  const project = getProjectForUser(db, userId, input.projectId);
  if (!project) throw new Error("Project not found.");
  const resolvedPages: InteriorPageInput[] = [];
  for (const page of input.pages) {
    if (!page.assetId) { resolvedPages.push(page); continue; }
    const asset = db.prepare(`SELECT id, storage_reference AS storageReference, mime_type AS mimeType, status, checksum_sha256 AS checksumSha256, updated_at AS updatedAt FROM generated_assets WHERE user_id = ? AND project_id = ? AND id = ?`).get(userId, input.projectId, page.assetId) as { id: string; storageReference: string; mimeType: "image/png" | "image/jpeg"; status: InteriorPageInput["assetStatus"]; checksumSha256: string; updatedAt: string } | undefined;
    if (!asset) { resolvedPages.push({ ...page, assetStatus: "missing" }); continue; }
    const quality = getQualityResultForAsset(db, userId, asset.id, "generated");
    const bytes = asset.status === "approved" && !quality?.blockingIssueCount ? await readPrivateStorageBytes(asset.storageReference).catch(() => undefined) : undefined;
    resolvedPages.push({ ...page, assetStatus: asset.status, assetVersion: page.assetVersion ?? asset.updatedAt, assetChecksumSha256: page.assetChecksumSha256 ?? asset.checksumSha256, assetMimeType: asset.mimeType, assetBytes: bytes, assetQualityBlockingIssues: quality?.blockingIssueCount ?? 0 });
  }
  const fonts = input.fonts ?? [];
  const source = { ...input, pages: resolvedPages, fonts };
  const assembled = await assembleInteriorPdf(source);
  const preview = await assembleInteriorPdf(source, true);
  const runId = crypto.randomUUID();
  const base = `${userId}/projects/${input.projectId}/interior-exports/${runId}`;
  const manifestRef = `${base}/layout-manifest.json`; const preflightRef = `${base}/preflight.json`; const previewRef = `${base}/preview.pdf`; const finalRef = `${base}/interior.pdf`;
  await storage.put(manifestRef, assembled.manifestBytes, "application/json"); await storage.put(preflightRef, assembled.preflightBytes, "application/json"); await storage.put(previewRef, preview.pdfBytes, "application/pdf");
  if (assembled.preflight.passed) await storage.put(finalRef, assembled.pdfBytes, "application/pdf");
  const now = new Date().toISOString(); const manifestHash = crypto.createHash("sha256").update(assembled.manifestBytes).digest("hex");
  db.prepare(`INSERT INTO interior_export_runs (id, user_id, project_id, ruleset_version, ordered_page_list_json, layout_manifest_storage_reference, preflight_report_storage_reference, interior_pdf_storage_reference, preview_pdf_storage_reference, page_count, blocking_issue_count, warning_count, layout_manifest_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, userId, input.projectId, INTERIOR_RULESET_VERSION, stableJson(input.pages), manifestRef, preflightRef, assembled.preflight.passed ? finalRef : null, previewRef, assembled.manifest.pageCount, assembled.preflight.blockingIssueCount, assembled.preflight.warningCount, manifestHash, assembled.preflight.passed ? "completed" : "blocked", now, now);
  return { runId, status: assembled.preflight.passed ? "completed" : "blocked", finalPdfAccessUrl: assembled.preflight.passed ? await storage.createAccessUrl(finalRef, 900) : null, previewPdfAccessUrl: await storage.createAccessUrl(previewRef, 900), manifestAccessUrl: await storage.createAccessUrl(manifestRef, 900), preflightAccessUrl: await storage.createAccessUrl(preflightRef, 900), preflight: assembled.preflight };
}
