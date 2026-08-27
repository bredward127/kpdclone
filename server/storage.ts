import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type PrivateStorage = {
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<{ key: string }>;
  delete: (key: string) => Promise<void>;
  createAccessUrl: (key: string, expiresInSeconds: number) => Promise<string>;
};

function storageRoot(): string {
  return process.env.PRIVATE_STORAGE_DIR ?? path.join(process.cwd(), "data", "private-storage");
}

function safePathForKey(key: string): string {
  const root = path.resolve(storageRoot());
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Invalid private storage key.");
  return target;
}

export function createLocalPrivateStorage(): PrivateStorage {
  return {
    async put(key, bytes) {
      const target = safePathForKey(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      return { key };
    },
    async delete(key) {
      await fs.rm(safePathForKey(key), { force: true });
    },
    async createAccessUrl(key, expiresInSeconds) {
      const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
      const message = `${key}:${expiresAt}`;
      const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET ?? "local-storage-secret").update(message).digest("base64url");
      return `/api/reference-assets/file?key=${encodeURIComponent(key)}&expires=${expiresAt}&signature=${signature}`;
    },
  };
}

export function verifyStorageAccessSignature(key: string, expires: number, signature: string): boolean {
  if (!key || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  const message = `${key}:${expires}`;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET ?? "local-storage-secret").update(message).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer);
}

export function readPrivateStorageBytes(key: string): Promise<Buffer> {
  return fs.readFile(safePathForKey(key));
}
