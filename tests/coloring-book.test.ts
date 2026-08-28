import { describe, expect, it } from "vitest";
import { createDatabase, createProject, updateProjectForUser, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePromptFromSavedProject } from "../server/prompt-composer";
import { isColoringLineArt, COLORING_PAGE_RULES } from "../shared/coloring-book";

const owner = { id: "col-owner", name: "Owner", email: "owner@example.com" };

function build(style: "full_color" | "coloring_line_art", brief: Partial<{ visualStyleAnchors: string; propAndSettingBible: string }> = {}) {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "cp", name: "Bedtime", brief: "A bedtime book." });
  updateProjectForUser(db, owner.id, project.id, { interiorArtStyle: style });
  createBookBrief(db, owner.id, {
    id: "cb", projectId: project.id, briefText: "A child wakes up.", bookType: "coloring_book", audience: "ages 4-8",
    visualStyleAnchors: brief.visualStyleAnchors ?? "Thick even outlines, rounded friendly shapes.",
    characterBible: "Mina wears striped pyjamas.",
    propAndSettingBible: brief.propAndSettingBible ?? "The nightstand is a short two-drawer pine box with round knobs. A round brass alarm clock with two bells sits on it.",
    negativePrompt: "No logos.",
  });
  const page = createPagePlan(db, owner.id, { id: "cpg", projectId: project.id, pageNumber: 1, sceneDirection: "Mina stretches in bed beside the nightstand.", pageText: "Good morning!" });
  const composed = composePromptFromSavedProject(db, owner.id, {
    projectId: project.id, pagePlanId: page.id, generationModel: "m", generationEndpoint: "e", aspectRatio: "1:1", referenceAssetIds: [], userEdits: {},
  });
  return composed;
}

describe("coloring-book interiors", () => {
  it("recognises the style flag", () => {
    expect(isColoringLineArt("coloring_line_art")).toBe(true);
    expect(isColoringLineArt("full_color")).toBe(false);
    expect(isColoringLineArt(undefined)).toBe(false);
  });

  it("binds every coloring rule into the composed prompt", () => {
    const composed = build("coloring_line_art");
    for (const rule of COLORING_PAGE_RULES) expect(composed.prompt).toContain(rule);
    expect(composed.prompt).toContain("COLORING PAGE LINE ART");
    expect(composed.prompt).toContain("coloring page (black line art to be coloured in)");
  });

  it("puts coloring negatives into the negative prompt, not just the body", () => {
    const composed = build("coloring_line_art");
    expect(composed.negativePrompt.toLowerCase()).toContain("no shading");
    expect(composed.negativePrompt.toLowerCase()).toContain("no gradients");
    expect(composed.negativePrompt.toLowerCase()).toContain("no watermark");
  });

  it("leaves a full-colour book untouched", () => {
    const composed = build("full_color");
    expect(composed.prompt).toContain("VISUAL STYLE");
    expect(composed.prompt).not.toContain("COLORING PAGE LINE ART");
    expect(composed.negativePrompt.toLowerCase()).not.toContain("no shading");
  });

  it("warns when colour or lighting direction contradicts a coloring page", () => {
    const composed = build("coloring_line_art", { visualStyleAnchors: "Warm watercolour with soft daylight." });
    const warning = composed.lintWarnings.find((entry) => entry.code === "coloring_style_conflict");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("warning");
  });

  it("does not warn when the anchors describe line quality only", () => {
    const composed = build("coloring_line_art");
    expect(composed.lintWarnings.find((entry) => entry.code === "coloring_style_conflict")).toBeUndefined();
  });
});

describe("recurring prop continuity", () => {
  it("repeats the prop bible verbatim into the page prompt", () => {
    // The nightstand-and-clock drift: nothing pinned recurring objects, so each
    // page invented its own version.
    const composed = build("coloring_line_art");
    expect(composed.prompt).toContain("RECURRING PROPS AND SETTINGS — REPRODUCE EXACTLY");
    expect(composed.prompt).toContain("round brass alarm clock with two bells");
    expect(composed.prompt).toContain("same shape, proportions, materials, colour and placement every time");
  });

  it("is identical across two pages of the same book", () => {
    const first = build("coloring_line_art").prompt;
    const second = build("coloring_line_art").prompt;
    const block = (text: string) => text.slice(text.indexOf("RECURRING PROPS AND SETTINGS"), text.indexOf("CHARACTER/SETTING CONTINUITY"));
    expect(block(first)).toBe(block(second));
    expect(block(first).length).toBeGreaterThan(50);
  });

  it("warns when no recurring props are recorded", () => {
    const composed = build("coloring_line_art", { propAndSettingBible: "" });
    const warning = composed.lintWarnings.find((entry) => entry.code === "missing_prop_continuity");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("warning");
  });

  it("does not warn once they are recorded", () => {
    expect(build("coloring_line_art").lintWarnings.find((entry) => entry.code === "missing_prop_continuity")).toBeUndefined();
  });
});
