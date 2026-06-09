import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { redis, sql } from "bun";
import { env } from "../../config/env";
import * as settings from "../settings";

/**
 * Session data stored in Redis per session key.
 *
 * `gen` captures the user's session-generation counter at the time the session
 * was created. Revoking all sessions for a user is an atomic INCR on that
 * counter; any stored session whose `gen` is below the current counter is
 * rejected by `getData()` without touching the session key itself.
 */
type SessionData = {
  userId: string;
  gen: number;
};

const sessionKey = (userId: string, randomToken: string) => `session:${userId}:${randomToken}`;
const genKey = (userId: string) => `session:gen:${userId}`;

/**
 * Read the current generation counter for a user. Missing key is treated as 0.
 * The counter never resets, only increments, so a user's earliest session has
 * `gen = 0` implicitly even before the first revocation.
 */
const readGen = async (userId: string): Promise<number> => {
  const raw = await redis.get(genKey(userId));
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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

const isCloudApiToken = (token: string | null): boolean => Boolean(token?.startsWith("cld_"));

export const session = {
  /**
   * Get session token from cookie or Authorization header.
   * Token format: userId:randomToken
   *
   * Note: the userId is embedded in the token to enable efficient generation
   * lookup and per-user key namespacing. The userId (UUID) is not secret.
   */
  getToken: (c: Context): string | null => {
    const cookie = getCookie(c, "session_token");
    const bearer = parseBearer(c.req.header("Authorization"));
    return cookie || (isCloudApiToken(bearer) ? null : bearer) || null;
  },

  getBearerToken: (c: Context): string | null => parseBearer(c.req.header("Authorization")),

  parseToken,

  create: async (c: Context, userId: string): Promise<string> => {
    const randomToken = crypto.randomUUID();
    const expiryHours = await settings.get<number>("user.session.expiry_hours");
    const ttl = expiryHours * 60 * 60;

    const gen = await readGen(userId);
    const data: SessionData = { userId, gen };
    await redis.set(sessionKey(userId, randomToken), JSON.stringify(data), "EX", ttl);

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

  /** Explicit logout — drops the current session key and cookie. Does not affect other sessions. */
  delete: async (c: Context): Promise<void> => {
    const token = session.getToken(c);
    if (token) {
      const parsed = parseToken(token);
      if (parsed) {
        await redis.del(sessionKey(parsed.userId, parsed.randomToken));
      }
    }
    deleteCookie(c, "session_token", { path: "/" });
  },

  /**
   * Atomically revoke every existing session for a user by bumping the
   * generation counter. Replaces the former SCAN+DEL loop. Future reads
   * via `getData()` will reject any session stored with the previous `gen`.
   *
   * Race-safe against concurrent `session.create()`: the newly-created session
   * either writes the pre-INCR gen (and is immediately invalid) or the
   * post-INCR gen (and is intentionally valid if the caller ordered INCR
   * before granting the new login).
   */
  revokeAllForUser: async (userId: string): Promise<void> => {
    await redis.incr(genKey(userId));
  },

  /**
   * Load session data, enforcing the generation check. Returns `null` when the
   * token is malformed, the key is missing/expired, or the stored `gen` is
   * below the user's current counter.
   */
  getData: async (token: string): Promise<SessionData | null> => {
    const parsed = parseToken(token);
    if (!parsed) return null;
    const raw = await redis.get(sessionKey(parsed.userId, parsed.randomToken));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    const currentGen = await readGen(parsed.userId);
    if ((data.gen ?? 0) < currentGen) return null;
    return data;
  },

};
