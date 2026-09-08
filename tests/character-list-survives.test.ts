import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { listBriefGenerations, saveBriefGeneration } from "../server/db-studio";

const owner = { id: "recall-owner", name: "Owner", email: "owner@example.com" };

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("a character list survives the actions taken on it", () => {
  it("declares no React component inside another component's body", () => {
    // A component defined in another component's render body is a new type on
    // every render, so React unmounts and remounts the whole subtree whenever
    // the parent's state changes -- taking every child's unsaved state with
    // it. That is what made the AI-drafted character list vanish the moment
    // "Add reference" set state on the page around it.
    const offenders: string[] = [];
    for (const file of tsxFiles("client/src")) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const declared = /^\s+function\s+[A-Z][A-Za-z0-9]*\s*\(/.test(line)
          || /^\s+const\s+[A-Z][A-Za-z0-9]*\s*=\s*(?:\(|function\b|memo\(|forwardRef\()/.test(line);
        if (declared) {
          offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a generation's characters so recalling it restores the checklist", () => {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "recall-project", name: "Moon Garden", brief: "" });
    const draft = {
      briefText: "A kitten learns to ask for help.",
      audience: "4-8",
      visualStyleAnchors: "Warm watercolor.",
      characterBible: "Milo and his mother.",
      propAndSettingBible: "A blue watering can.",
      negativePrompt: "No logos.",
      characters: [
        { name: "Milo", description: "A small orange kitten with a blue collar." },
        { name: "Milo's mother", description: "A larger orange cat with the same markings." },
      ],
    };

    const saved = saveBriefGeneration(db, owner.id, project.id, "A shy kitten", draft);
    expect(saved.characters).toEqual(draft.characters);

    const [recalled] = listBriefGenerations(db, owner.id, project.id);
    expect(recalled.characters).toEqual(draft.characters);
    expect(recalled.idea).toBe("A shy kitten");
  });

  it("returns an empty list for a generation drafted without characters", () => {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "recall-project-2", name: "Moon Garden", brief: "" });
    saveBriefGeneration(db, owner.id, project.id, "An idea", {
      briefText: "A story.", audience: "4-8", visualStyleAnchors: "Ink.",
      characterBible: "A fox.", propAndSettingBible: "", negativePrompt: "No logos.",
    });
    expect(listBriefGenerations(db, owner.id, project.id)[0].characters).toEqual([]);
  });

  it("drops a nameless character rather than storing an empty checklist row", () => {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "recall-project-3", name: "Moon Garden", brief: "" });
    saveBriefGeneration(db, owner.id, project.id, "An idea", {
      briefText: "A story.", audience: "4-8", visualStyleAnchors: "Ink.",
      characterBible: "A fox.", propAndSettingBible: "", negativePrompt: "No logos.",
      characters: [{ name: "  ", description: "nameless" }, { name: "Fern", description: "A red fox." }],
    });
    expect(listBriefGenerations(db, owner.id, project.id)[0].characters).toEqual([{ name: "Fern", description: "A red fox." }]);
  });
});
