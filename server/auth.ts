import crypto from "node:crypto";
import type { Request, Response } from "express";
import { parse, serialize } from "cookie";
import { z } from "zod";
import { upsertUser, type AppDatabase, type UserRecord } from "./db";

const SESSION_COOKIE = "kdp_session";
const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().nullable(),
  expiresAt: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be configured in production");
  }
  return secret ?? "local-development-only-session-secret";
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decodeSession(value: string | undefined): UserRecord | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = sessionPayloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (payload.expiresAt <= Date.now()) return null;
    return { id: payload.userId, name: payload.name, email: payload.email };
  } catch {
    return null;
  }
}

export function setSession(res: Response, user: UserRecord, maxAgeSeconds = 60 * 60 * 24 * 7): void {
  const payload: SessionPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  };
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE, encodeSession(payload), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: maxAgeSeconds,
    }),
  );
}

export function clearSession(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    }),
  );
}

function fromTrustedProxy(req: Request): UserRecord | null {
  if (process.env.TRUSTED_AUTH_PROXY !== "true") return null;
  const userId = req.header("x-authenticated-user-id");
  if (!userId) return null;
  const name = req.header("x-authenticated-user-name") || "Creator";
  const email = req.header("x-authenticated-user-email") || null;
  return { id: userId, name, email };
}

export function getCurrentUser(req: Request, db: AppDatabase): UserRecord | null {
  const proxyUser = fromTrustedProxy(req);
  if (proxyUser) {
    return upsertUser(db, proxyUser);
  }

  const cookies = parse(req.headers.cookie ?? "");
  const sessionUser = decodeSession(cookies[SESSION_COOKIE]);
  if (sessionUser) {
    return upsertUser(db, sessionUser);
  }
  return null;
}

export function isDevAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_AUTH !== "false";
}
