import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createAppRouter } from "../server/routers";
import { assertReferenceCanBeUsedForGeneration, deleteReferenceAssetForUser, getReferenceAssetForUser, listReferenceAssets, updateReferenceLabel, uploadReferenceAsset } from "../server/reference-assets";
import { validateReferenceImage } from "../server/reference-validation";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "reference-owner", name: "Reference Owner", email: "owner@example.com" };
const stranger = { id: "reference-stranger", name: "Reference Stranger", email: "stranger@example.com" };
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function makeStorage(options: { failPut?: boolean } = {}) {
  const writes = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const storage: PrivateStorage = {
    put: vi.fn(async (key, bytes) => {
      writes.set(key, bytes);
      if (options.failPut) throw new Error("storage write failed");
      return { key };
    }),
    delete: vi.fn(async (key) => {
      deleted.push(key);
      writes.delete(key);
    }),
    createAccessUrl: vi.fn(async (key) => `/private/${encodeURIComponent(key)}`),
  };
  return { storage, writes, deleted };
}

function makeFixture(storage: PrivateStorage) {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  upsertUser(db, stranger);
  const project = createProject(db, owner.id, { id: "reference-project", name: "Reference Book", brief: "A book." });
  const router = createAppRouter(db, { storage });
  return { db, project, router };
}

describe("visual-reference security", () => {
  it("requires authentication and prevents another user from reading the project reference list", async () => {
    const { storage } = makeStorage();
    const { db, project, router } = makeFixture(storage);
    const unauthenticated = router.createCaller({ db, user: null });
    const otherUser = router.createCaller({ db, user: stranger });

    await expect(unauthenticated.references.list({ projectId: project.id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(otherUser.references.list({ projectId: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects corrupted, mismatched, and oversized images before storage", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const input = {
      projectId: project.id,
      referenceKind: "moodboard" as const,
      originalFilename: "moodboard.png",
      provenanceDeclaration: "user_owned" as const,
      rightsAttestation: true,
    };

    await expect(uploadReferenceAsset(db, storage, owner.id, { ...input, declaredMimeType: "image/png", bytes: Buffer.from("not-an-image") }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 })).rejects.toThrow("corrupted or unsafe");
    await expect(uploadReferenceAsset(db, storage, owner.id, { ...input, declaredMimeType: "image/jpeg", bytes: pngBytes }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 })).rejects.toThrow("does not match");
    await expect(uploadReferenceAsset(db, storage, owner.id, { ...input, declaredMimeType: "image/png", bytes: Buffer.alloc(101) }, { maxBytes: 100, maxPixels: 1_000_000, maxDimension: 2_000 })).rejects.toThrow("file-size limit");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("requires the rights attestation before upload or generation use", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const input = {
      projectId: project.id,
      referenceKind: "character_sheet" as const,
      originalFilename: "character.png",
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned" as const,
      bytes: pngBytes,
    };
    await expect(uploadReferenceAsset(db, storage, owner.id, { ...input, rightsAttestation: false }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 })).rejects.toThrow(/rights/i);
    const record = await uploadReferenceAsset(db, storage, owner.id, { ...input, rightsAttestation: true }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    expect(assertReferenceCanBeUsedForGeneration(db, owner.id, record.id).id).toBe(record.id);
  });

  it("cleans up a storage object when persistence fails after storage is attempted", async () => {
    const { storage, deleted } = makeStorage({ failPut: true });
    const { db, project } = makeFixture(storage);
    await expect(uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "sketch_reference",
      originalFilename: "sketch.png",
      declaredMimeType: "image/png",
      provenanceDeclaration: "permission_granted",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 })).rejects.toThrow("storage write failed");
    expect(storage.put).toHaveBeenCalledOnce();
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(deleted).toHaveLength(1);
    expect(listReferenceAssets(db, owner.id, project.id)).toEqual([]);
  });

  it("marks deleted references unavailable and keeps them out of active listings", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "cover_reference",
      originalFilename: "cover.png",
      declaredMimeType: "image/png",
      provenanceDeclaration: "licensed",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    const deleted = await deleteReferenceAssetForUser(db, storage, owner.id, record.id);
    expect(deleted?.status).toBe("deleted");
    expect(listReferenceAssets(db, owner.id, project.id)).toEqual([]);
    expect(getReferenceAssetForUser(db, stranger.id, record.id)).toBeNull();
    expect(() => assertReferenceCanBeUsedForGeneration(db, owner.id, record.id)).toThrow("unavailable");
    await expect(deleteReferenceAssetForUser(db, storage, owner.id, record.id)).resolves.toBeNull();
  });
});

describe("reference labels: what a picture depicts and how to use it", () => {
  it("saves and returns the label and usage notes on upload", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "character_sheet",
      originalFilename: "car.png",
      label: "Danny's car — a red 1967 Mustang convertible",
      usageNotes: "Use whenever the car appears; match colour and shape exactly.",
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    expect(record.label).toBe("Danny's car — a red 1967 Mustang convertible");
    expect(record.usageNotes).toBe("Use whenever the car appears; match colour and shape exactly.");
    // A fresh read must see the same values, not just the just-created record.
    const reloaded = getReferenceAssetForUser(db, owner.id, record.id);
    expect(reloaded?.label).toBe(record.label);
    expect(reloaded?.usageNotes).toBe(record.usageNotes);
  });

  it("defaults to empty strings when no label or usage notes are given", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "moodboard",
      originalFilename: "mood.png",
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    expect(record.label).toBe("");
    expect(record.usageNotes).toBe("");
  });

  it("trims and length-caps a label and usage notes rather than rejecting them", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "character_sheet",
      originalFilename: "car.png",
      label: `  ${"x".repeat(250)}  `,
      usageNotes: `  ${"y".repeat(600)}  `,
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    expect(record.label).toHaveLength(200);
    expect(record.label.startsWith(" ")).toBe(false);
    expect(record.usageNotes).toHaveLength(500);
  });

  it("edits the label and usage notes without touching the stored image", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "character_sheet",
      originalFilename: "car.png",
      label: "First description",
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });

    const updated = updateReferenceLabel(db, owner.id, record.id, { label: "The red Mustang", usageNotes: "Use in every driving scene." });
    expect(updated.label).toBe("The red Mustang");
    expect(updated.usageNotes).toBe("Use in every driving scene.");
    expect(updated.storageKey).toBe(record.storageKey);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("refuses to edit a reference the caller does not own or that is gone", async () => {
    const { storage } = makeStorage();
    const { db, project } = makeFixture(storage);
    const record = await uploadReferenceAsset(db, storage, owner.id, {
      projectId: project.id,
      referenceKind: "character_sheet",
      originalFilename: "car.png",
      declaredMimeType: "image/png",
      provenanceDeclaration: "user_owned",
      rightsAttestation: true,
      bytes: pngBytes,
    }, { maxBytes: 100_000, maxPixels: 1_000_000, maxDimension: 2_000 });
    expect(() => updateReferenceLabel(db, stranger.id, record.id, { label: "hijacked" })).toThrow(/unavailable/);
    await deleteReferenceAssetForUser(db, storage, owner.id, record.id);
    expect(() => updateReferenceLabel(db, owner.id, record.id, { label: "too late" })).toThrow(/unavailable/);
  });
});
