import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePrompt, composePromptFromSavedProject, createPromptVersion, getPromptVersionForUser, listPromptVersions, restorePromptVersion, stableSerialize } from "../server/prompt-composer";
import { createAppRouter } from "../server/routers";

const owner = { id: "prompt-owner", name: "Prompt Owner", email: "owner@example.com" };
const stranger = { id: "prompt-stranger", name: "Prompt Stranger", email: "stranger@example.com" };

function makeFixture() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  upsertUser(db, stranger);
  const project = createProject(db, owner.id, { id: "prompt-project", name: "Moon Garden", brief: "A gentle picture book." });
  createBookBrief(db, owner.id, {
    id: "brief-prompt",
    projectId: project.id,
    briefText: "A child finds courage under the moon.",
    bookType: "picture_book",
    audience: "preschool children",
    visualStyleAnchors: "Indigo and cream palette, soft gouache texture, rounded silhouettes, quiet rim light.",
    characterBible: "Mina is a small child with a yellow raincoat and a red satchel; the moon garden is safe and inviting.",
    negativePrompt: "No logos, no watermarks, no accidental text, no extra fingers.",
  });
  const page = createPagePlan(db, owner.id, { id: "page-prompt", projectId: project.id, pageNumber: 1, sceneDirection: "Mina opens the garden gate and looks up at the moon.", pageText: "The gate creaked softly." });
  return { db, project, page };
}

describe("deterministic prompt composition", () => {
  it("always emits the required structured sections and preserves saved decisions", () => {
    const { db, project, page } = makeFixture();
    const composed = composePromptFromSavedProject(db, owner.id, {
      projectId: project.id,
      pagePlanId: page.id,
      generationModel: "Reviewed image model",
      generationEndpoint: "reviewed/image-endpoint",
      aspectRatio: "2:3",
      seed: 42,
      referenceAssetIds: ["missing-reference"],
      userEdits: { promptAddition: "Place the gate on the left with open space on the right.", compositionNotes: "Leave the lower third quiet for page text." },
    });

    for (const label of ["BOOK IDENTITY", "INTENDED AUDIENCE", "CHARACTER/SETTING CONTINUITY", "SPECIFIC PAGE SCENE", "VISUAL STYLE", "COMPOSITION", "PRINT-SAFE REQUIREMENTS", "NEGATIVE CONSTRAINTS", "MODEL-SPECIFIC PARAMETERS"]) {
      expect(composed.prompt).toContain(`[${label}]`);
    }
    expect(composed.prompt).toContain("Mina opens the garden gate");
    expect(composed.prompt).toContain("Leave the lower third quiet");
    expect(composed.prompt).toContain("Aspect ratio: 2:3");
    expect(composed.negativePrompt).toContain("No logos");
    expect(composed.lintWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsupported_visual_asset", evidence: "missing-reference" })]));
    expect(composed.contentHashSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same content hash for equivalent object key order and inputs", () => {
    const first = stableSerialize({ b: 2, a: { d: 4, c: 3 }, list: [{ z: 1, a: 2 }] });
    const second = stableSerialize({ list: [{ a: 2, z: 1 }], a: { c: 3, d: 4 }, b: 2 });
    expect(first).toBe(second);
    const source = { bookProject: { id: "p", name: "Book", brief: "", title: "Book", author: "", imprint: "", bookType: "picture_book", readingDirection: "ltr", trimWidthInches: 8, trimHeightInches: 10, bleedPreference: "no_bleed", paperSelection: "white", inkSelection: "black_ink", pageCount: 24 }, bookBrief: null, pagePlan: null, approvedReferenceAssets: [], requestedReferenceAssetIds: [] } as const;
    const args = { source, generationModel: "model", generationEndpoint: "endpoint", aspectRatio: "2:3", referenceAssetIds: [] as string[] };
    expect(composePrompt(args).contentHashSha256).toBe(composePrompt({ ...args, userEdits: {} }).contentHashSha256);
  });

  it("warns without rewriting user content for safety-sensitive or conflicting requests", () => {
    const source = {
      bookProject: { id: "p", name: "Brand Book", brief: "Disney character in the style of a living artist.", title: "Brand Book", author: "", imprint: "", bookType: "picture_book", readingDirection: "ltr", trimWidthInches: 8, trimHeightInches: 10, bleedPreference: "no_bleed", paperSelection: "white", inkSelection: "black_ink", pageCount: 24 },
      bookBrief: { briefText: "An adult story about a toddler.", audience: "adult readers", visualStyleAnchors: "beautiful", characterBible: "A toddler wearing a costume.", negativePrompt: "" },
      pagePlan: { pageNumber: 1, pageText: "", sceneDirection: "" },
      approvedReferenceAssets: [],
      requestedReferenceAssetIds: [],
    } as never;
    const composed = composePrompt({ source, generationModel: "model", generationEndpoint: "endpoint", aspectRatio: "1:1", referenceAssetIds: [], userEdits: { promptAddition: "A sexual nude child portrait. In the style of a living artist, use a full bleed even though this book has no bleed." } });
    const codes = composed.lintWarnings.map((warning) => warning.code);
    expect(codes).toEqual(expect.arrayContaining(["missing_subject", "vague_style", "inconsistent_age_style", "copyright_or_trademark_request", "living_artist_style_request", "sexual_or_minor_content", "conflicting_print_constraints"]));
    expect(composed.prompt).toContain("sexual nude child portrait");
    expect(composed.prompt).toContain("living artist");
  });
});

describe("immutable prompt versions", () => {
  it("persists source snapshots, links eligible references, increments versions, and restores by creating a new version", () => {
    const { db, project, page } = makeFixture();
    const input = { projectId: project.id, pagePlanId: page.id, generationModel: "model", generationEndpoint: "endpoint", aspectRatio: "1:1", referenceAssetIds: [] as string[], userEdits: { promptAddition: "Keep the moon centered." } };
    const composed = composePromptFromSavedProject(db, owner.id, input);
    const first = createPromptVersion(db, owner.id, composed, input);
    expect(first.version).toBe(1);
    expect(first.sourceFieldSnapshot.pagePlan?.sceneDirection).toContain("garden gate");

    const second = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, { ...input, userEdits: { promptAddition: "Move the moon to the upper right." } }), { ...input, userEdits: { promptAddition: "Move the moon to the upper right." } });
    expect(second.version).toBe(2);
    expect(getPromptVersionForUser(db, owner.id, first.id)?.prompt).toContain("Keep the moon centered");
    expect(getPromptVersionForUser(db, stranger.id, first.id)).toBeNull();
    expect(listPromptVersions(db, stranger.id, project.id, page.id)).toEqual([]);

    const restored = restorePromptVersion(db, owner.id, first.id);
    expect(restored.version).toBe(3);
    expect(restored.restoredFromPromptVersionId).toBe(first.id);
    expect(restored.prompt).toBe(first.prompt);
    expect(listPromptVersions(db, owner.id, project.id, page.id)).toHaveLength(3);
  });

  it("exposes compare and restore only through protected owner-scoped procedures", async () => {
    const { db, project, page } = makeFixture();
    const router = createAppRouter(db);
    const ownerCaller = router.createCaller({ db, user: owner });
    const strangerCaller = router.createCaller({ db, user: stranger });
    const saved = await ownerCaller.studio.prompts.composeAndSave({ projectId: project.id, pagePlanId: page.id, generationModel: "model", generationEndpoint: "endpoint", aspectRatio: "1:1", referenceAssetIds: [] });
    await expect(strangerCaller.studio.prompts.list({ projectId: project.id, pagePlanId: page.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(strangerCaller.studio.prompts.restore({ projectId: project.id, promptVersionId: saved.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.studio.prompts.restore({ projectId: project.id, promptVersionId: saved.id })).resolves.toMatchObject({ restoredFromPromptVersionId: saved.id, version: 2 });
  });
});
