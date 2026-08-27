import { describe, expect, it } from "vitest";
import { getPageStudioDisplayStatus, pageStudioStatusLabels } from "../client/src/lib/page-studio-status";

describe("Page Studio status rendering", () => {
  it("renders the requested creator-facing lifecycle labels", () => {
    expect(Object.values(pageStudioStatusLabels)).toEqual(expect.arrayContaining(["Draft", "Queued", "Generating", "Needs Review", "Approved", "Failed", "Cancelled", "Superseded"]));
    expect(getPageStudioDisplayStatus("queued")).toBe("queued");
    expect(getPageStudioDisplayStatus("in_progress")).toBe("in_progress");
    expect(getPageStudioDisplayStatus("needs_review")).toBe("needs_review");
    expect(getPageStudioDisplayStatus("approved")).toBe("approved");
    expect(getPageStudioDisplayStatus("failed")).toBe("failed");
    expect(getPageStudioDisplayStatus("cancelled")).toBe("cancelled");
    expect(getPageStudioDisplayStatus("superseded")).toBe("superseded");
  });

  it("falls back to Draft for unknown or missing provider states", () => {
    expect(getPageStudioDisplayStatus("provider_unknown")).toBe("draft");
    expect(getPageStudioDisplayStatus(null, null)).toBe("draft");
  });
});
