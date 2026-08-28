import { describe, expect, it } from "vitest";
import {
  DEFAULT_KDP_RULESET,
  DEFAULT_KDP_SOURCE_URLS,
  evaluatePaperbackPackage,
  type KdpRuleset,
  type PaperbackPreflightInput,
} from "../server/kdp-preflight";
import { interiorPhysicalSize } from "../server/interior-pdf";

const ruleset: KdpRuleset = {
  id: "rules-bleed",
  version: "2026.09",
  effectiveDate: "2026-09-01",
  status: "active",
  config: DEFAULT_KDP_RULESET,
  sourceUrls: DEFAULT_KDP_SOURCE_URLS,
  reviewedByUserId: "admin",
  reviewedAt: "2026-09-01T00:00:00.000Z",
  reviewNotes: "Bleed geometry regression fixture.",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/**
 * The named fixture project from the playbook: a 24-page, 8.5 x 11 in,
 * left-to-right children's coloring book, built WITH bleed.
 */
function bleedInput(overrides: Partial<PaperbackPreflightInput> = {}): PaperbackPreflightInput {
  const page = interiorPhysicalSize(8.5, 11, true);
  return {
    projectId: "garden-friends",
    trimWidthInches: 8.5,
    trimHeightInches: 11,
    bleed: true,
    interiorPageCount: 24,
    readingDirection: "ltr",
    interior: {
      pdfBytes: Buffer.from("interior"),
      widthInches: page.width,
      heightInches: page.height,
      pageCount: 24,
      pages: Array.from({ length: 24 }, (_, index) => ({ pageNumber: index + 1, blank: false, assetId: `asset-${index + 1}`, effectiveDpi: 300 })),
      fontsEmbedded: [],
      manifestReadingDirection: "ltr",
      measuredOutsideMarginInches: 0.375,
      measuredGutterMarginInches: 0.375,
    },
    cover: {
      pdfBytes: Buffer.from("cover"),
      pageCount: 1,
      widthInches: 17.5,
      heightInches: 11.25,
      expectedWidthInches: 17.5,
      expectedHeightInches: 11.25,
      templateCurrent: true,
      templateSourceUrl: DEFAULT_KDP_SOURCE_URLS[2],
      templateFingerprintMatches: true,
      safeZoneWarnings: [],
      bleedCovered: true,
      barcodeClear: true,
      spineEligible: true,
      spineTextInsideSafeZone: true,
      flattened: true,
      hasGuideContent: false,
      sourceAssetIds: ["cover-front-v1"],
    },
    expectedInteriorWidthInches: page.width,
    expectedInteriorHeightInches: page.height,
    permittedFontIds: [],
    ...overrides,
  };
}

const codes = (input: PaperbackPreflightInput) => evaluatePaperbackPackage(input, ruleset).results.map((result) => result.ruleId);

describe("paperback preflight — bleed geometry regression", () => {
  it("clears a correctly built 8.625 x 11.25 in bleed interior", () => {
    const report = evaluatePaperbackPackage(bleedInput(), ruleset);
    expect(report.blockingIssueCount).toBe(0);
    expect(report.readyForManualKdpUploadReview).toBe(true);
  });

  it("rejects the previously expected symmetric 8.75 x 11.25 in page", () => {
    const input = bleedInput();
    const found = codes({ ...input, interior: { ...input.interior, widthInches: 8.75, heightInches: 11.25 } });
    expect(found).toContain("paperback.interior_pdf_dimensions");
    expect(found).toContain("paperback.interior_bleed_mode");
  });

  it("rejects bleed applied to the inside edge as well as the outside", () => {
    const input = bleedInput();
    // 8.5 + 0.125 on both vertical edges: the spine edge must never receive bleed.
    expect(codes({ ...input, interior: { ...input.interior, widthInches: 8.75 } })).toContain("paperback.interior_bleed_mode");
  });

  it("rejects a bleed interior whose margins only meet the no-bleed minimum", () => {
    const input = bleedInput();
    expect(codes({ ...input, interior: { ...input.interior, measuredOutsideMarginInches: 0.25 } })).toContain("paperback.margins");
  });

  it("still clears a no-bleed interior built at exactly the trim size", () => {
    const page = interiorPhysicalSize(8.5, 11, false);
    const input = bleedInput({ bleed: false });
    const report = evaluatePaperbackPackage(
      {
        ...input,
        interior: { ...input.interior, widthInches: page.width, heightInches: page.height, measuredOutsideMarginInches: 0.25 },
        expectedInteriorWidthInches: page.width,
        expectedInteriorHeightInches: page.height,
      },
      ruleset,
    );
    expect(report.blockingIssueCount).toBe(0);
  });

  it("applies the 0.75 / 0.875 in gutter boundary at 700 and 701 pages", () => {
    const input = bleedInput();
    const at700 = { ...input, interiorPageCount: 700, interior: { ...input.interior, measuredGutterMarginInches: 0.75 } };
    expect(codes(at700)).not.toContain("paperback.margins");
    const at701 = { ...input, interiorPageCount: 701, interior: { ...input.interior, measuredGutterMarginInches: 0.75 } };
    expect(codes(at701)).toContain("paperback.margins");
  });
});
