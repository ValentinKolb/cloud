import { sql } from "bun";
import type { RequestActor } from "../server";

export const AI_USER_INSTRUCTIONS_MAX_CHARS = 4_000;
export const AI_USER_MEMORY_MAX_CHARS = 24_000;

export type AiUserPrefs = {
  userId: string;
  instructions: string;
  memory: string;
  memoryEnabled: boolean;
  /** Model profile id of the user's most recent chat turn — preselected for new chats. */
  lastModelId: string;
  updatedAt: string;
};

type PrefsRow = {
  user_id: string;
  instructions: string;
  memory: string;
  memory_enabled: boolean;
  last_model_id: string | null;
  updated_at: string | Date;
};

const toPrefs = (row: PrefsRow): AiUserPrefs => ({
  userId: row.user_id,
  instructions: row.instructions,
  memory: row.memory,
  memoryEnabled: row.memory_enabled,
  lastModelId: row.last_model_id ?? "",
  updatedAt: new Date(row.updated_at).toISOString(),
});

const emptyPrefs = (userId: string): AiUserPrefs => ({
  userId,
  instructions: "",
  memory: "",
  memoryEnabled: true,
  lastModelId: "",
  updatedAt: new Date(0).toISOString(),
});

const MEMORY_DATE_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

/** Strip the leading `[YYYY-MM-DD] ` stamp from a memory line (user-edited lines may not have one). */
export const stripMemoryDatePrefix = (line: string): string => line.replace(MEMORY_DATE_PREFIX_RE, "");

/** The user a chat turn runs for — direct users and delegated service-account users. */
export const aiActorUser = (actor: RequestActor | undefined) => {
  if (!actor) return undefined;
  if (actor.kind === "user") return actor.user;
  return actor.delegatedUser ?? undefined;
};

/** The user whose prefs and memory apply to a turn. */
export const aiPrefsUserId = (actor: RequestActor | undefined): string | null => aiActorUser(actor)?.id ?? null;

export const aiUserPrefs = {
  async get(userId: string): Promise<AiUserPrefs> {
    const rows = (await sql`SELECT * FROM ai.user_prefs WHERE user_id = ${userId}`) as PrefsRow[];
    return rows[0] ? toPrefs(rows[0]) : emptyPrefs(userId);
  },

  async update(
    userId: string,
    patch: { instructions?: string; memory?: string; memoryEnabled?: boolean; lastModelId?: string },
  ): Promise<AiUserPrefs> {
    const instructions = patch.instructions?.slice(0, AI_USER_INSTRUCTIONS_MAX_CHARS) ?? null;
    const memory = patch.memory?.slice(0, AI_USER_MEMORY_MAX_CHARS) ?? null;
    const memoryEnabled = patch.memoryEnabled ?? null;
    const lastModelId = patch.lastModelId?.trim().slice(0, 200) ?? null;
    const rows = (await sql`
      INSERT INTO ai.user_prefs (user_id, instructions, memory, memory_enabled, last_model_id, updated_at)
      VALUES (${userId}, ${instructions ?? ""}, ${memory ?? ""}, ${memoryEnabled ?? true}, ${lastModelId ?? ""}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        instructions = COALESCE(${instructions}, ai.user_prefs.instructions),
        memory = COALESCE(${memory}, ai.user_prefs.memory),
        memory_enabled = COALESCE(${memoryEnabled}, ai.user_prefs.memory_enabled),
        last_model_id = COALESCE(${lastModelId}, ai.user_prefs.last_model_id),
        updated_at = now()
      RETURNING *
    `) as PrefsRow[];
    return toPrefs(rows[0]!);
  },

  /** Append one memory line, date-stamped so the model can judge how current it is. Returns the stored line, or null when full. */
  async addMemory(userId: string, entry: string, now: Date = new Date()): Promise<string | null> {
    const body = stripMemoryDatePrefix(entry.replace(/\s+/g, " ").trim());
    if (!body) return null;
    const line = `[${now.toISOString().slice(0, 10)}] ${body}`;
    const prefs = await this.get(userId);
    const next = prefs.memory ? `${prefs.memory.trimEnd()}\n${line}` : line;
    if (next.length > AI_USER_MEMORY_MAX_CHARS) return null;
    await this.update(userId, { memory: next });
    return line;
  },

  /** Remove every memory line containing `match` (case-insensitive, date prefixes ignored). Returns the removed lines. */
  async removeMemory(userId: string, match: string): Promise<string[]> {
    const needle = stripMemoryDatePrefix(match.trim()).toLowerCase();
    if (!needle) return [];
    const prefs = await this.get(userId);
    const lines = prefs.memory.split("\n");
    const matches = (line: string) => Boolean(line.trim()) && stripMemoryDatePrefix(line).toLowerCase().includes(needle);
    const removed = lines.filter(matches);
    if (removed.length === 0) return [];
    await this.update(userId, {
      memory: lines
        .filter((line) => !matches(line))
        .join("\n")
        .trim(),
    });
    return removed.map((line) => line.trim());
  },
};
