import { describe, expect, it } from "vitest";
import { queueRequestPath } from "../server/fal-queue";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePromptFromSavedProject, NO_TEXT_RULE_MARKER } from "../server/prompt-composer";

describe("queue request paths", () => {
  it("addresses request sub-paths at the application, not the model sub-route", () => {
    // A three-segment endpoint submitted in full must still be polled at
    // owner/app; appending to the full path is what FAL answered 405 on.
    expect(queueRequestPath("https://queue.fal.run", "fal-ai/flux/schnell", "/requests/abc/status"))
      .toBe("https://queue.fal.run/fal-ai/flux/requests/abc/status");
    expect(queueRequestPath("https://queue.fal.run", "fal-ai/flux/dev", "/requests/abc/cancel"))
      .toBe("https://queue.fal.run/fal-ai/flux/requests/abc/cancel");
  });

  it("leaves a two-segment endpoint unchanged", () => {
    expect(queueRequestPath("https://queue.fal.run", "fal-ai/gpt-image-1.5", "/requests/xyz/response"))
      .toBe("https://queue.fal.run/fal-ai/gpt-image-1.5/requests/xyz/response");
  });

  it("tolerates surrounding slashes", () => {
    expect(queueRequestPath("https://queue.fal.run", "/fal-ai/flux/schnell/", "/requests/1/status"))
      .toBe("https://queue.fal.run/fal-ai/flux/requests/1/status");
  });
});

describe("no text in generated artwork", () => {
  const owner = { id: "no-text-owner", name: "Owner", email: "owner@example.com" };

  function fixture() {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "no-text-project", name: "Moon Garden", brief: "A picture book." });
    createBookBrief(db, owner.id, { id: "no-text-brief", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool children", visualStyleAnchors: "Indigo gouache.", characterBible: "Mina wears a yellow raincoat.", negativePrompt: "No logos." });
    const page = createPagePlan(db, owner.id, { id: "no-text-page", projectId: project.id, pageNumber: 4, sceneDirection: "Mina opens the garden gate.", pageText: "THE GATE CREAKED OPEN SLOWLY." });
    return { db, project, page };
  }

  it("never sends the page's story text to the image model", () => {
    const { db, project, page } = fixture();
    const composed = composePromptFromSavedProject(db, owner.id, {
      projectId: project.id, pagePlanId: page.id,
      generationModel: "Reviewed model", generationEndpoint: "reviewed/model",
      aspectRatio: "1:1", referenceAssetIds: [],
    });
    // The verbatim story text is what the model was rendering into the art.
    expect(composed.prompt).not.toContain("THE GATE CREAKED OPEN SLOWLY");
    expect(composed.prompt).not.toMatch(/Page text:/);
    // The scene direction must still reach the model.
    expect(composed.prompt).toContain("Mina opens the garden gate.");
  });

  it("binds a no-text rule into the prompt and the negative prompt", () => {
    const { db, project, page } = fixture();
    const composed = composePromptFromSavedProject(db, owner.id, {
      projectId: project.id, pagePlanId: page.id,
      generationModel: "Reviewed model", generationEndpoint: "reviewed/model",
      aspectRatio: "1:1", referenceAssetIds: [],
    });
    expect(composed.prompt).toContain("NO TEXT IN THE IMAGE — BINDING");
    for (const term of ["speech bubble", "watermark", "lettering", "signature"]) {
      expect(composed.negativePrompt).toContain(term);
    }
  });

  it("keeps the no-text negation even when the author wrote their own negative prompt", () => {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "p2", name: "B", brief: "" });
    createBookBrief(db, owner.id, { id: "b2", projectId: project.id, briefText: "A story.", bookType: "picture_book", audience: "children", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "no scary faces" });
    const page = createPagePlan(db, owner.id, { id: "pg2", projectId: project.id, pageNumber: 1, sceneDirection: "A fox naps.", pageText: "Sleep well." });
    const composed = composePromptFromSavedProject(db, owner.id, {
      projectId: project.id, pagePlanId: page.id,
      generationModel: "M", generationEndpoint: "e/m", aspectRatio: "1:1", referenceAssetIds: [],
    });
    expect(composed.negativePrompt).toContain("no scary faces");
    expect(composed.negativePrompt).toContain("lettering");
  });
});

describe("stale frozen prompts are not reused", () => {
  const owner = { id: "stale-owner", name: "Owner", email: "o@example.com" };

  it("recognises a pre-fix prompt by the absence of the no-text rule", () => {
    // Prompts frozen before the rule existed carry the page's story text, and
    // regenerating from one puts that lettering back into the artwork.
    const preFix = "[SPECIFIC PAGE SCENE]\nPage 4: Mina opens the gate.\nPage text: THE GATE CREAKED.";
    const current = `[SPECIFIC PAGE SCENE]\nPage 4: Mina opens the gate.\n\n[${NO_TEXT_RULE_MARKER}]\nDraw artwork only.`;
    expect(preFix.includes(NO_TEXT_RULE_MARKER)).toBe(false);
    expect(current.includes(NO_TEXT_RULE_MARKER)).toBe(true);
  });

  it("marks every freshly composed prompt as current", () => {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "stale-p", name: "B", brief: "" });
    createBookBrief(db, owner.id, { id: "stale-b", projectId: project.id, briefText: "A story.", bookType: "picture_book", audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "no logos" });
    const page = createPagePlan(db, owner.id, { id: "stale-pg", projectId: project.id, pageNumber: 1, sceneDirection: "A fox naps.", pageText: "Sleep well." });
    const composed = composePromptFromSavedProject(db, owner.id, {
      projectId: project.id, pagePlanId: page.id,
      generationModel: "M", generationEndpoint: "e/m", aspectRatio: "1:1", referenceAssetIds: [],
    });
    expect(composed.prompt).toContain(NO_TEXT_RULE_MARKER);
    expect(composed.prompt).not.toContain("Sleep well.");
  });
});
