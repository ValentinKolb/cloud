import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { redis, sql } from "bun";
import { env } from "@valentinkolb/cloud-core/config/env";
import * as settings from "@valentinkolb/cloud-core/services/settings";

/** Data stored in Redis for each session. */
type SessionData = {
  userId: string;
  ipaSession: string | null;
};

const scanKeys = async (pattern: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const result = (await redis.scan(cursor, "MATCH", pattern, "COUNT", 100)) as unknown;
    const nextCursor = Array.isArray(result) ? String(result[0] ?? "0") : String((result as { cursor?: string | number }).cursor ?? "0");
    const batch = Array.isArray(result) ? result[1] : (result as { keys?: string[] }).keys;

    if (Array.isArray(batch)) {
      keys.push(...batch.map(String));
    }

    cursor = nextCursor;
  } while (cursor !== "0");

  return keys;
};

const parseToken = (token: string): { userId: string; randomToken: string } | null => {
  const colonIndex = token.indexOf(":");
  if (colonIndex === -1) return null;
  const userId = token.slice(0, colonIndex);
  const randomToken = token.slice(colonIndex + 1);
  if (!userId || !randomToken) return null;
  return { userId, randomToken };
};

const parseBearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
};

export const session = {
  /**
   * Get session token from cookie or Authorization header.
   * Token format: userId:randomToken
   */
  getToken: (c: Context): string | null => {
    const cookie = getCookie(c, "session_token");
    const bearer = parseBearer(c.req.header("Authorization"));
    return cookie || bearer || null;
  },

  /**
   * Parse a session token into userId and random token parts.
   * Token format: userId:randomToken
   */
  parseToken,

  create: async (c: Context, userId: string, ipaSession: string | null = null): Promise<string> => {
    const randomToken = crypto.randomUUID();
    const expiryHours = await settings.get<number>("user.session.expiry_hours");
    const ttl = expiryHours * 60 * 60;

    const data: SessionData = { userId, ipaSession };
    await redis.set(`session:${userId}:${randomToken}`, JSON.stringify(data), "EX", ttl);

    await sql`UPDATE auth.users SET last_login_local = now() WHERE id = ${userId}`;

    const clientToken = `${userId}:${randomToken}`;

    setCookie(c, "session_token", clientToken, {
      httpOnly: true,
      secure: !env.IS_DEVELOPMENT,
      sameSite: "Lax",
      maxAge: ttl,
      path: "/",
    });

    return clientToken;
  },

  delete: async (c: Context): Promise<void> => {
    const token = session.getToken(c);
    if (token) {
      const parsed = parseToken(token);
      if (parsed) {
        await redis.del(`session:${parsed.userId}:${parsed.randomToken}`);
      }
    }
    deleteCookie(c, "session_token", { path: "/" });
  },

  /**
   * Delete all sessions for a specific user.
   * Useful when promoting a guest user to IPA user - forces re-login.
   */
  deleteAllForUser: async (userId: string): Promise<void> => {
    const keys = await scanKeys(`session:${userId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  },

  getData: async (token: string): Promise<SessionData | null> => {
    const parsed = parseToken(token);
    if (!parsed) return null;
    const raw = await redis.get(`session:${parsed.userId}:${parsed.randomToken}`);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  },

  getIpaSession: async (token: string): Promise<string | null> => {
    const data = await session.getData(token);
    return data?.ipaSession ?? null;
  },
};
