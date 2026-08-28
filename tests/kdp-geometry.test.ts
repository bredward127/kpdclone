import { describe, expect, it } from "vitest";
import {
  GUTTER_TIERS,
  gutterMarginInches,
  interiorPageSizeInches,
  isSpineTextEligible,
  outsideMarginInches,
  topBottomMarginInches,
} from "../shared/kdp-geometry";
import { interiorPhysicalSize, kdpInteriorRules } from "../server/interior-pdf";
import { DEFAULT_KDP_RULESET } from "../server/kdp-preflight";

describe("KDP interior page geometry", () => {
  it("adds bleed to the outside edge once and to top and bottom twice", () => {
    // 8.5 x 11 is the fixture trim for the coloring-book test project.
    expect(interiorPageSizeInches(8.5, 11, true)).toEqual({ width: 8.625, height: 11.25 });
    // The classic KDP worked example.
    expect(interiorPageSizeInches(6, 9, true)).toEqual({ width: 6.125, height: 9.25 });
    expect(interiorPageSizeInches(8.5, 8.5, true)).toEqual({ width: 8.625, height: 8.75 });
  });

  it("uses the trim size exactly when bleed is off", () => {
    expect(interiorPageSizeInches(8.5, 11, false)).toEqual({ width: 8.5, height: 11 });
    expect(interiorPageSizeInches(6, 9, false)).toEqual({ width: 6, height: 9 });
  });

  it("never adds bleed symmetrically to both axes", () => {
    const bleedPage = interiorPageSizeInches(8.5, 11, true);
    expect(bleedPage.width).not.toBeCloseTo(8.75, 5);
    expect(bleedPage.height - 11).toBeCloseTo((bleedPage.width - 8.5) * 2, 5);
  });

  it("steps the gutter at every published page-count boundary", () => {
    expect(gutterMarginInches(24)).toBe(0.375);
    expect(gutterMarginInches(150)).toBe(0.375);
    expect(gutterMarginInches(151)).toBe(0.5);
    expect(gutterMarginInches(300)).toBe(0.5);
    expect(gutterMarginInches(301)).toBe(0.625);
    expect(gutterMarginInches(500)).toBe(0.625);
    expect(gutterMarginInches(501)).toBe(0.75);
    expect(gutterMarginInches(700)).toBe(0.75);
    expect(gutterMarginInches(701)).toBe(0.875);
    expect(gutterMarginInches(828)).toBe(0.875);
  });

  it("never returns a gutter above the published maximum", () => {
    for (const tier of GUTTER_TIERS) expect(tier.inches).toBeLessThanOrEqual(0.875);
    expect(gutterMarginInches(900)).toBe(0.875);
  });

  it("raises outside, top and bottom minimums together when bleed is on", () => {
    expect(outsideMarginInches(false)).toBe(0.25);
    expect(outsideMarginInches(true)).toBe(0.375);
    expect(topBottomMarginInches(true)).toBe(0.375);
    expect(topBottomMarginInches(false)).toBe(0.25);
  });

  it("excludes 79-page books from spine text and admits 80", () => {
    expect(isSpineTextEligible(79)).toBe(false);
    expect(isSpineTextEligible(80)).toBe(true);
  });
});

describe("geometry consumers cannot drift apart", () => {
  it("builds the interior at exactly the size preflight expects", () => {
    for (const [w, h] of [[8.5, 11], [6, 9], [8.5, 8.5]] as const) {
      for (const bleed of [true, false]) {
        expect(interiorPhysicalSize(w, h, bleed)).toEqual(interiorPageSizeInches(w, h, bleed));
      }
    }
  });

  it("shares one gutter table between the builder and the ruleset", () => {
    for (const pageCount of [24, 150, 151, 300, 301, 500, 501, 700, 701, 828]) {
      const fromBuilder = kdpInteriorRules(pageCount, true).insideMarginInches;
      const fromRuleset = gutterMarginInches(pageCount, DEFAULT_KDP_RULESET.paperback.margins.gutterByPageRange);
      expect(fromBuilder).toBe(fromRuleset);
    }
  });

  it("carries the bleed allowance into the builder's own rule output", () => {
    const rules = kdpInteriorRules(24, true);
    expect(rules.bleedWidthInches).toBe(0.125);
    expect(rules.bleedHeightInches).toBe(0.25);
    expect(rules.topMarginInches).toBe(0.375);
    expect(rules.bottomMarginInches).toBe(0.375);
    const noBleed = kdpInteriorRules(24, false);
    expect(noBleed.bleedWidthInches).toBe(0);
    expect(noBleed.bleedHeightInches).toBe(0);
    expect(noBleed.topMarginInches).toBe(0.25);
  });
});
