import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { assembleInteriorPdf, interiorPhysicalSize, preflightInterior, type InteriorBuildInput, type InteriorPageInput } from "../server/interior-pdf";

const fontBytesPromise = readFile(new URL("../node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff", import.meta.url));
async function imageBytes(color = { r: 235, g: 235, b: 235 }) { return sharp({ create: { width: 600, height: 600, channels: 3, background: color } }).png().toBuffer(); }
function base(pages: InteriorBuildInput["pages"], pageCount = pages.length): InteriorBuildInput { return { projectId: "interior-test", trimWidthInches: 8.5, trimHeightInches: 8.5, bleed: false, pageCount, paperSelection: "white", inkSelection: "black_ink", readingDirection: "ltr", pages, fonts: [] }; }
function coloringPages(count: number): InteriorPageInput[] { return Array.from({ length: count }, (_, index) => ({ id: `color-${index + 1}`, pageNumber: index + 1, pageType: "coloring_page" as const, assetId: `asset-${index + 1}`, assetStatus: "approved" as const })); }

describe("interior PDF assembly", () => {
  it("assembles a 24-page coloring-book interior with approved assets", async () => { const pages = coloringPages(24); const bytes = await imageBytes(); pages.forEach((page) => { page.assetBytes = bytes; page.assetMimeType = "image/png"; }); const result = await assembleInteriorPdf(base(pages, 24)); expect(result.preflight.passed).toBe(true); expect(result.manifest.pageCount).toBe(24); expect((await PDFDocument.load(result.pdfBytes)).getPageCount()).toBe(24); });
  it("supports a picture-book spread with creator text and mirrored pagination", async () => { const bytes = await imageBytes({ r: 210, g: 225, b: 240 }); const result = await assembleInteriorPdf(base([{ id: "p1", pageNumber: 1, pageType: "storybook_text_spread", assetId: "a1", assetStatus: "approved", assetBytes: bytes, assetMimeType: "image/png", imagePlacement: { x: 0, y: 0, width: 8.5, height: 8.5 }, textBlocks: [{ id: "t1", text: "A quiet beginning", x: 0.5, y: 0.5, width: 6, height: 1, fontSize: 18 }] }, { id: "p2", pageNumber: 2, pageType: "storybook_text_spread", assetId: "a2", assetStatus: "approved", assetBytes: bytes, assetMimeType: "image/png", textBlocks: [{ id: "t2", text: "The page turns.", x: 1, y: 1, width: 5, height: 1, fontSize: 18 }] }], 2)); expect(result.preflight.passed).toBe(true); expect(result.manifest.pages.map((page) => page.side)).toEqual(["right", "left"]); expect((await PDFDocument.load(result.pdfBytes)).getPageCount()).toBe(2); });
  it("calculates non-bleed and bleed physical sizes", () => { expect(interiorPhysicalSize(8.5, 8.5, false)).toEqual({ width: 8.5, height: 8.5 }); expect(interiorPhysicalSize(8.5, 8.5, true)).toEqual({ width: 8.625, height: 8.75 }); });
  it("warns and pads an odd page count without changing ordered source pages", async () => { const pages = Array.from({ length: 5 }, (_, index) => ({ id: `p-${index + 1}`, pageNumber: index + 1, pageType: "intentional_blank" as const, intentionallyBlank: true })); const result = await assembleInteriorPdf(base(pages, 5)); expect(result.preflight.issues.some((issue) => issue.code === "odd_page_count_padded")).toBe(true); expect(result.manifest.pageCount).toBe(6); });
  it("blocks missing and unapproved assets, long blank runs, and reports margin warnings", () => { const report = preflightInterior(base([{ id: "bad", pageNumber: 1, pageType: "coloring_page", assetId: "unapproved", assetStatus: "needs_review" }, { id: "b1", pageNumber: 2, pageType: "intentional_blank", intentionallyBlank: true }, { id: "b2", pageNumber: 3, pageType: "intentional_blank", intentionallyBlank: true }, { id: "b3", pageNumber: 4, pageType: "intentional_blank", intentionallyBlank: true }, { id: "text", pageNumber: 5, pageType: "storybook_text_spread", textBlocks: [{ id: "edge", text: "too close", x: 0, y: 0, width: 1, height: 1, fontSize: 12 }] }], 5)); expect(report.blockingIssueCount).toBeGreaterThan(0); expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unapproved_coloring_asset", "long_blank_page_run", "margin_warning"])); });
  it("embeds permitted fonts and produces a reproducible manifest", async () => {
    const fontBytes = await fontBytesPromise;
    const input: InteriorBuildInput = {
      ...base([{ id: "text", pageNumber: 1, pageType: "front_matter", textBlocks: [{ id: "t", text: "Copyright", x: 1, y: 1, width: 5, height: 1, fontSize: 14, fontId: "noto" }] }], 1),
      fonts: [{ id: "noto", family: "Noto Sans", bytes: fontBytes, permitted: true }],
    };
    const first = await assembleInteriorPdf(input);
    const second = await assembleInteriorPdf(input);
    expect(Buffer.from(first.manifestBytes).equals(Buffer.from(second.manifestBytes))).toBe(true);
    expect(first.manifest.fonts).toEqual([{ id: "noto", family: "Noto Sans", embedded: true }]);
    expect(Buffer.from(first.pdfBytes).includes(Buffer.from("/FontFile2"))).toBe(true);
  });
});
