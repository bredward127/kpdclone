import { describe, expect, it } from "vitest";
import { blockingLintWarnings, composePrompt, type PromptSourceSnapshot } from "../server/prompt-composer";
import { classifyContentPolicy } from "../server/publishing";

const project: PromptSourceSnapshot["bookProject"] = {
  id: "garden-friends",
  name: "Garden Friends",
  brief: "A calm coloring adventure for young readers.",
  title: "Garden Friends",
  author: "Test Creator",
  imprint: "",
  bookType: "coloring_book",
  readingDirection: "ltr",
  trimWidthInches: 8.5,
  trimHeightInches: 11,
  bleedPreference: "no_bleed",
  paperSelection: "white",
  inkSelection: "black_ink",
  pageCount: 24,
};

/** The exact brief the operator guide tells a first-time creator to type in. */
function benignSource(): PromptSourceSnapshot {
  return {
    bookProject: project,
    bookBrief: {
      briefText: "A calm coloring adventure set in a community garden.",
      audience: "Children ages 4-7; large open coloring areas and simple recognizable objects",
      visualStyleAnchors: "Original black line art, smooth thick outlines, friendly rounded forms, sparse detail, white background",
      characterBible: "Milo is a small dog with one floppy ear and a bandana. Pip is a round bird with three feather marks.",
      negativePrompt: "No readable text, no logos, no brands, no copyrighted characters",
    },
    pagePlan: { pageNumber: 3, sceneDirection: "Milo waters a row of sunflowers while Pip sits on the fence.", pageText: "Milo helps the garden grow." },
    approvedReferenceAssets: [],
    requestedReferenceAssetIds: [],
  } as unknown as PromptSourceSnapshot;
}

function compose(source: PromptSourceSnapshot, promptAddition?: string) {
  return composePrompt({
    source,
    generationModel: "model",
    generationEndpoint: "endpoint",
    aspectRatio: "1:1",
    referenceAssetIds: [],
    userEdits: promptAddition ? { promptAddition } : undefined,
  });
}

describe("child-safety lint — false positives", () => {
  it("does not fire on an ordinary children's coloring-book brief", () => {
    const codes = compose(benignSource()).lintWarnings.map((warning) => warning.code);
    expect(codes).not.toContain("sexual_or_minor_content");
  });

  it("does not fire merely because the audience field says Children", () => {
    // The old rule matched "child" inside "children", making half its condition
    // permanently true for every project this product can create.
    const source = benignSource();
    const codes = compose(source, "Add three more sunflowers behind the fence.").lintWarnings.map((warning) => warning.code);
    expect(codes).not.toContain("sexual_or_minor_content");
  });

  it("leaves the benign brief with no blocking findings at all", () => {
    expect(blockingLintWarnings(compose(benignSource()).lintWarnings)).toHaveLength(0);
  });
});

describe("child-safety lint — true positives", () => {
  it("blocks a sexualizing descriptor even with no child noun beside it", () => {
    const composed = compose(benignSource(), "Make the pose seductive.");
    const warning = composed.lintWarnings.find((entry) => entry.code === "sexual_or_minor_content");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("blocking");
    expect(blockingLintWarnings(composed.lintWarnings)).toHaveLength(1);
  });

  it("reports the matched term as evidence instead of a fixed string", () => {
    const composed = compose(benignSource(), "A nude figure in the garden.");
    const warning = composed.lintWarnings.find((entry) => entry.code === "sexual_or_minor_content");
    expect(warning!.evidence.toLowerCase()).toBe("nude");
    expect(warning!.evidence).not.toContain("minor/child and sexualized terms detected");
  });

  it("still catches the descriptor when a child noun is present", () => {
    const composed = compose(benignSource(), "A sexual nude child portrait.");
    const warning = composed.lintWarnings.find((entry) => entry.code === "sexual_or_minor_content");
    expect(warning!.severity).toBe("blocking");
  });
});

describe("the separate hard content block is unchanged", () => {
  it("still blocks explicit exploitation phrases regardless of the lint layer", () => {
    expect(classifyContentPolicy("child porn").status).toBe("blocked");
    expect(classifyContentPolicy("sexualized child").status).toBe("blocked");
    expect(classifyContentPolicy("minor sex").status).toBe("blocked");
  });

  it("still clears an ordinary coloring-book prompt", () => {
    expect(classifyContentPolicy("Milo waters a row of sunflowers for children ages 4-7.").status).toBe("cleared");
  });
});
