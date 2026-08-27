import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { analyzeAssetQuality } from "../server/asset-quality";

const owner = { id: "quality-owner", name: "Quality Owner", email: "quality@example.com" };

async function fixture(width: number, height: number, background = { r: 255, g: 255, b: 255, alpha: 1 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

function setup() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "quality-project", name: "Quality Book", brief: "Fixture book" });
  db.prepare(`INSERT INTO reference_assets (id, user_id, project_id, reference_kind, original_filename, mime_type, width_px, height_px, byte_size, storage_key, content_hash_sha256, provenance_declaration, rights_attestation, rights_attested_at, status, created_at, updated_at) VALUES (?, ?, ?, 'sketch_reference', 'fixture.png', 'image/png', ?, ?, ?, ?, ?, 'user_owned', 1, ?, 'active', ?, ?)`);
  return { db, project };
}

async function insertReference(db: ReturnType<typeof createDatabase>, projectId: string, id: string, bytes: Buffer, hash: string) {
  const now = new Date().toISOString();
  const metadata = await sharp(bytes).metadata();
  db.prepare(`INSERT INTO reference_assets (id, user_id, project_id, reference_kind, original_filename, mime_type, width_px, height_px, byte_size, storage_key, content_hash_sha256, provenance_declaration, rights_attestation, rights_attested_at, status, created_at, updated_at) VALUES (?, ?, ?, 'sketch_reference', 'fixture.png', 'image/png', ?, ?, ?, ?, ?, 'user_owned', 1, ?, 'active', ?, ?)`).run(id, owner.id, projectId, metadata.width, metadata.height, bytes.byteLength, `${id}.png`, hash, now, now, now);
}

describe("asset quality review", () => {
  it("blocks below-300 effective DPI and reports exact required pixels", async () => {
    const { db, project } = setup();
    const bytes = await fixture(300, 300);
    await insertReference(db, project.id, "ref-low", bytes, "hash-low");
    const result = await analyzeAssetQuality(db, { userId: owner.id, projectId: project.id, referenceAssetId: "ref-low", checksumSha256: "hash-low", bytes, declaredMimeType: "image/png", placedWidthInches: 2, placedHeightInches: 2 });
    expect(result.overallStatus).toBe("blocked");
    expect(result.effectiveDpi).toBe(150);
    expect(result.requiredWidthPx).toBe(600);
    expect(result.requiredHeightPx).toBe(600);
    expect(result.issues.find((issue) => issue.code === "effective_dpi_below_300")?.message).toContain("600 × 600px");
  });

  it("flags blank and forbidden alpha content without approving it", async () => {
    const { db, project } = setup();
    const bytes = await fixture(600, 600, { r: 255, g: 255, b: 255, alpha: 0.5 });
    await insertReference(db, project.id, "ref-alpha", bytes, "hash-alpha");
    const result = await analyzeAssetQuality(db, { userId: owner.id, projectId: project.id, referenceAssetId: "ref-alpha", checksumSha256: "hash-alpha", bytes, declaredMimeType: "image/png", placedWidthInches: 2, placedHeightInches: 2, allowAlpha: false });
    expect(result.overallStatus).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["near_blank", "unexpected_alpha"]));
    expect(result.humanApprovalRequired).toBe(true);
  });

  it("records duplicate hashes and coloring-book heuristic warnings", async () => {
    const { db, project } = setup();
    const bytes = await sharp(Buffer.from(`<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="600" fill="white"/><path d="M0 100 H600 M0 200 H600 M0 300 H600 M0 400 H600 M0 500 H600" stroke="#eeeeee" stroke-width="12" fill="none"/></svg>`)).png().toBuffer();
    await insertReference(db, project.id, "ref-one", bytes, "same-hash");
    await insertReference(db, project.id, "ref-two", bytes, "same-hash");
    await analyzeAssetQuality(db, { userId: owner.id, projectId: project.id, referenceAssetId: "ref-one", checksumSha256: "same-hash", bytes, declaredMimeType: "image/png", placedWidthInches: 2, placedHeightInches: 2, coloringBook: true });
    const result = await analyzeAssetQuality(db, { userId: owner.id, projectId: project.id, referenceAssetId: "ref-two", checksumSha256: "same-hash", bytes, declaredMimeType: "image/png", placedWidthInches: 2, placedHeightInches: 2, coloringBook: true });
    expect(result.warningCount).toBeGreaterThanOrEqual(2);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["duplicate_asset_hash", "coloring_line_contrast"]));
    expect(result.overallStatus).toBe("warnings");
  });
});
