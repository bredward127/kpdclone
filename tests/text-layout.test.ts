import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { getTextLayout, saveTextLayout } from "../server/text-layout-store";
import {
  DEFAULT_TEXT_LAYOUT, FONT_CHOICES, fontChoice, imageHeightInches, isOverlay,
  recommendLayout, resolveLayout, textBlockRect,
} from "../shared/text-layout";

const owner = { id: "layout-owner", name: "Owner", email: "owner@example.com" };

function fixture() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "layout-project", name: "Moon Garden", brief: "" });
  return { db, project };
}

describe("text layout persistence", () => {
  it("falls back to shared defaults when a book has never been typeset", () => {
    const { db, project } = fixture();
    expect(getTextLayout(db, owner.id, project.id)).toEqual({ ...DEFAULT_TEXT_LAYOUT, pageOverrides: {} });
  });

  it("round-trips settings and per-page overrides", () => {
    const { db, project } = fixture();
    const saved = saveTextLayout(db, owner.id, project.id, {
      ...DEFAULT_TEXT_LAYOUT, fontId: "helvetica_bold", fontSize: 24, align: "left",
      placement: "overlay_bottom", colorHex: "#ffffff", showPageNumbers: true,
      pageOverrides: { "page-7": { fontSize: 14, align: "right" } },
    });
    expect(saved.fontId).toBe("helvetica_bold");
    expect(saved.showPageNumbers).toBe(true);
    expect(saved.pageOverrides["page-7"]).toEqual({ fontSize: 14, align: "right" });
    // Re-reading must give the same thing, not a default.
    expect(getTextLayout(db, owner.id, project.id)).toEqual(saved);
  });

  it("updates in place rather than creating a second row per book", () => {
    const { db, project } = fixture();
    saveTextLayout(db, owner.id, project.id, { ...DEFAULT_TEXT_LAYOUT, pageOverrides: {} });
    saveTextLayout(db, owner.id, project.id, { ...DEFAULT_TEXT_LAYOUT, fontSize: 30, pageOverrides: {} });
    const rows = db.prepare("SELECT COUNT(*) AS count FROM interior_text_layouts WHERE user_id = ? AND project_id = ?").get(owner.id, project.id) as { count: number };
    expect(rows.count).toBe(1);
    expect(getTextLayout(db, owner.id, project.id).fontSize).toBe(30);
  });

  it("keeps one book's typesetting out of another's", () => {
    const { db, project } = fixture();
    const other = createProject(db, owner.id, { id: "other-project", name: "Other", brief: "" });
    saveTextLayout(db, owner.id, project.id, { ...DEFAULT_TEXT_LAYOUT, fontSize: 30, pageOverrides: {} });
    expect(getTextLayout(db, owner.id, other.id).fontSize).toBe(DEFAULT_TEXT_LAYOUT.fontSize);
  });
});

describe("text geometry shared by the preview and the PDF", () => {
  it("places a bottom band inside the margin and a top band below the top margin", () => {
    const bottom = textBlockRect({ ...DEFAULT_TEXT_LAYOUT, placement: "below_image", marginInches: 0.5, textBandInches: 1.6 }, 8.5, 8.5);
    expect(bottom).toEqual({ x: 0.5, y: 0.5, width: 7.5, height: 1.6 });
    const top = textBlockRect({ ...DEFAULT_TEXT_LAYOUT, placement: "overlay_top", marginInches: 0.5, textBandInches: 1.6 }, 8.5, 8.5);
    expect(top.y).toBeCloseTo(8.5 - 0.5 - 1.6, 5);
    expect(top.x).toBe(0.5);
  });

  it("never lets the band or margin exceed the page", () => {
    const rect = textBlockRect({ ...DEFAULT_TEXT_LAYOUT, marginInches: 9, textBandInches: 99 }, 6, 9);
    expect(rect.x).toBeLessThanOrEqual(2);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(9);
  });

  it("gives the artwork the full page only when the text overlays it", () => {
    expect(isOverlay("overlay_bottom")).toBe(true);
    expect(isOverlay("below_image")).toBe(false);
    expect(imageHeightInches({ ...DEFAULT_TEXT_LAYOUT, placement: "overlay_bottom" }, 8.5)).toBe(8.5);
    expect(imageHeightInches({ ...DEFAULT_TEXT_LAYOUT, placement: "below_image", textBandInches: 1.6, marginInches: 0.5 }, 8.5)).toBeLessThan(8.5);
  });

  it("resolves a page override over the book default without mutating it", () => {
    const base = { ...DEFAULT_TEXT_LAYOUT, fontSize: 18 };
    expect(resolveLayout(base, { fontSize: 28 }).fontSize).toBe(28);
    expect(resolveLayout(base).fontSize).toBe(18);
    expect(base.fontSize).toBe(18);
  });

  it("offers only fonts the PDF writer can resolve, and falls back for unknown ids", () => {
    for (const choice of FONT_CHOICES) expect(choice.standardFont).toMatch(/^(Times|Helvetica|Courier)/);
    expect(fontChoice("no-such-font").id).toBe(FONT_CHOICES[0].id);
  });
});

describe("layout recommendation", () => {
  it("uses large bold type for the youngest readers", () => {
    const result = recommendLayout({ trimWidthInches: 8.5, trimHeightInches: 8.5, audience: "Ages 3-5, read aloud" });
    expect(result.fontSize).toBeGreaterThanOrEqual(24);
    expect(result.fontId).toBe("helvetica_bold");
    expect(result.reason).toContain("3");
  });

  it("keeps text off the art for a coloring interior", () => {
    const result = recommendLayout({ trimWidthInches: 8.5, trimHeightInches: 11, coloringBook: true });
    expect(isOverlay(result.placement)).toBe(false);
    expect(result.reason).toContain("coloring");
  });

  it("grows the band for long page text and caps it at half the page", () => {
    const long = recommendLayout({ trimWidthInches: 8.5, trimHeightInches: 8.5, audience: "Ages 6-8", longestPageTextLength: 400 });
    expect(long.textBandInches).toBeGreaterThan(1.6);
    expect(long.textBandInches).toBeLessThanOrEqual(8.5 / 2);
  });

  it("holds type down on a narrow trim", () => {
    const narrow = recommendLayout({ trimWidthInches: 6, trimHeightInches: 9, audience: "Ages 3-5" });
    expect(narrow.fontSize).toBeLessThanOrEqual(20);
    expect(narrow.reason).toContain("6in");
  });

  it("still returns a usable default with nothing declared", () => {
    const result = recommendLayout({ trimWidthInches: 8.5, trimHeightInches: 8.5 });
    expect(result.fontSize).toBeGreaterThan(0);
    expect(FONT_CHOICES.some((choice) => choice.id === result.fontId)).toBe(true);
  });
});
