import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, getBriefForProject } from "../server/db-studio";
import { createAppRouter } from "../server/routers";

const owner = { id: "chars-owner", name: "Owner", email: "owner@example.com" };
const stranger = { id: "chars-stranger", name: "Stranger", email: "stranger@example.com" };

function makeFixture() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  upsertUser(db, stranger);
  const project = createProject(db, owner.id, { id: "chars-project", name: "Moon Garden", brief: "" });
  return { db, project };
}

describe("named characters persist alongside the brief", () => {
  it("round-trips characters through save and read", () => {
    const { db, project } = makeFixture();
    const characters = [
      { name: "Milo", description: "A small orange kitten with a blue collar." },
      { name: "Milo's mother", description: "A larger orange cat with the same markings." },
    ];
    createBookBrief(db, owner.id, {
      id: "brief-1", projectId: project.id, briefText: "A story.", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "Milo and his mother.",
      negativePrompt: "No logos.", characters,
    });
    const reloaded = getBriefForProject(db, owner.id, project.id);
    expect(reloaded?.characters).toEqual(characters);
  });

  it("defaults to an empty list when no characters are given", () => {
    const { db, project } = makeFixture();
    createBookBrief(db, owner.id, {
      id: "brief-2", projectId: project.id, briefText: "A story.", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.",
    });
    expect(getBriefForProject(db, owner.id, project.id)?.characters).toEqual([]);
  });

  it("drops a character with no name rather than storing an empty entry", () => {
    const { db, project } = makeFixture();
    createBookBrief(db, owner.id, {
      id: "brief-3", projectId: project.id, briefText: "A story.", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.",
      characters: [{ name: "  ", description: "nameless" }, { name: "Fern", description: "A red fox." }],
    });
    expect(getBriefForProject(db, owner.id, project.id)?.characters).toEqual([{ name: "Fern", description: "A red fox." }]);
  });

  it("keeps each version's own character list as new versions are saved", () => {
    const { db, project } = makeFixture();
    createBookBrief(db, owner.id, {
      id: "brief-4a", projectId: project.id, briefText: "v1", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.",
      characters: [{ name: "Fern", description: "A red fox." }],
    });
    createBookBrief(db, owner.id, {
      id: "brief-4b", projectId: project.id, briefText: "v2", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox and an owl.", negativePrompt: "No logos.",
      characters: [{ name: "Fern", description: "A red fox." }, { name: "Owl", description: "A grey owl." }],
    });
    const latest = getBriefForProject(db, owner.id, project.id);
    expect(latest?.version).toBe(2);
    expect(latest?.characters).toHaveLength(2);
  });

  it("gracefully returns an empty list if the stored JSON is somehow malformed", () => {
    const { db, project } = makeFixture();
    createBookBrief(db, owner.id, {
      id: "brief-5", projectId: project.id, briefText: "v1", bookType: "picture_book",
      audience: "4-8", visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.",
    });
    db.prepare("UPDATE book_briefs SET characters_json = ? WHERE id = ?").run("not json", "brief-5");
    expect(getBriefForProject(db, owner.id, project.id)?.characters).toEqual([]);
  });

  it("only the owner can save or read a project's character list", async () => {
    const { db, project } = makeFixture();
    const router = createAppRouter(db);
    const ownerCaller = router.createCaller({ db, user: owner });
    const strangerCaller = router.createCaller({ db, user: stranger });

    const saved = await ownerCaller.studio.brief.save({
      projectId: project.id, briefText: "A story.", bookType: "picture_book", audience: "4-8",
      visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.",
      characters: [{ name: "Fern", description: "A red fox." }],
    });
    expect(saved.characters).toEqual([{ name: "Fern", description: "A red fox." }]);

    await expect(strangerCaller.studio.brief.save({
      projectId: project.id, briefText: "hijacked", bookType: "picture_book", audience: "4-8",
      visualStyleAnchors: "Ink.", characterBible: "A fox.", negativePrompt: "No logos.", characters: [],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const read = await ownerCaller.studio.brief.get({ projectId: project.id });
    expect(read?.characters).toEqual([{ name: "Fern", description: "A red fox." }]);
    await expect(strangerCaller.studio.brief.get({ projectId: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
