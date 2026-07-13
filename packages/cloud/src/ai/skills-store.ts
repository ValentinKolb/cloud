import { sql } from "bun";
import {
  type AccessEntry,
  createAccess,
  deleteAccess,
  type PermissionLevel,
  type Principal,
  resolveDisplayNames,
} from "../server/services/access";
import { escapeLikePattern, toPgTextArray, toPgUuidArray } from "../services/postgres";
import { normalizeAiFilePath } from "./files-store";

export const AI_SKILL_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const AI_SKILL_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const AI_SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export type AiSkillEventKind =
  | "created"
  | "updated"
  | "deleted"
  | "enabled"
  | "disabled"
  | "shared"
  | "unshared"
  | "code_review_requested"
  | "code_approved"
  | "code_revoked";

export type AiSkill = {
  id: string;
  slug: string;
  /** NULL = workspace skill (admin-managed, may run code). */
  ownerUserId: string | null;
  /** Derived from SKILL.md frontmatter — the file is the single source of truth. */
  description: string;
  enabled: boolean;
  allowCode: boolean;
  codeApprovedBy: string | null;
  codeApprovedAt: string | null;
  codeApprovedHash: string | null;
  codeReviewRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiSkillFileStat = { path: string; size: number; mediaType: string; updatedAt: string };

export type AiSkillTreeFile = { path: string; bytes: Uint8Array; mediaType: string };

export type AiSkillTreeSnapshot = {
  skillId: string;
  contentHash: string;
  files: Array<AiSkillFileStat & { bytes: Uint8Array }>;
};

export type AiSkillTreeReplaceResult =
  | { ok: true; snapshot: AiSkillTreeSnapshot }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; currentHash: string };

export type AiSkillOrigin = "own" | "workspace" | "shared";

/** A skill as one user sees it: origin decides the default activation (foreign shares are opt-in). */
export type AiSkillUserView = AiSkill & {
  origin: AiSkillOrigin;
  /** Effective per-user activation after applying the consent defaults. */
  userState: "enabled" | "disabled";
};

export type AiSkillEvent = {
  id: string;
  skillId: string;
  skillSlug: string;
  actorUserId: string | null;
  /** Resolved display name; NULL = platform action (seeding) or deleted account. */
  actorDisplayName: string | null;
  event: AiSkillEventKind;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

type SkillRow = {
  id: string;
  slug: string;
  owner_user_id: string | null;
  enabled: boolean;
  allow_code: boolean;
  code_approved_by: string | null;
  code_approved_at: Date | string | null;
  code_approved_hash: string | null;
  code_review_requested_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** SKILL.md text when the query joined it — source of the description. */
  skill_md?: string | null;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value));
const toJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

/** Extract `description:` from the SKILL.md YAML frontmatter (single line, optionally quoted). */
export const parseAiSkillDescription = (skillMd: string): string => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd.trimStart());
  if (!frontmatter) return "";
  const line = frontmatter[1]!.split(/\r?\n/).find((candidate) => /^description\s*:/i.test(candidate.trim()));
  if (!line) return "";
  let value = line.slice(line.indexOf(":") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value;
};

const toSkill = (row: SkillRow): AiSkill => ({
  id: row.id,
  slug: row.slug,
  ownerUserId: row.owner_user_id,
  description: parseAiSkillDescription(row.skill_md ?? ""),
  enabled: row.enabled,
  allowCode: row.allow_code,
  codeApprovedBy: row.code_approved_by,
  codeApprovedAt: isoOrNull(row.code_approved_at),
  codeApprovedHash: row.code_approved_hash,
  codeReviewRequestedAt: isoOrNull(row.code_review_requested_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const recordEvent = async (input: {
  skillId: string;
  skillSlug: string;
  actorUserId: string | null;
  event: AiSkillEventKind;
  meta?: Record<string, unknown>;
}): Promise<void> => {
  await sql`
    INSERT INTO ai.skill_events (skill_id, skill_slug, actor_user_id, event, meta)
    VALUES (${input.skillId}, ${input.skillSlug}, ${input.actorUserId}, ${input.event}, ${input.meta ? JSON.stringify(input.meta) : null}::jsonb)
  `;
};

/**
 * Approval binds to the content: any file change after a code approval makes
 * the hash stale — allow_code is revoked automatically and re-review is
 * required. Hash = sha256 over sorted (path, bytes) pairs of the whole tree.
 */
const hashAiSkillFiles = (rows: Array<{ path: string; bytes: Uint8Array }>): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  const sortedRows = [...rows].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const row of sortedRows) {
    hasher.update(`\0${row.path}\0`);
    hasher.update(row.bytes);
  }
  return hasher.digest("hex");
};

export const computeAiSkillContentHash = async (skillId: string): Promise<string> => {
  const rows = await sql<{ path: string; bytes: Uint8Array }[]>`
    SELECT path, bytes FROM ai.skill_files WHERE skill_id = ${skillId} ORDER BY path ASC
  `;
  return hashAiSkillFiles(rows.map((row) => ({ path: row.path, bytes: new Uint8Array(row.bytes ?? []) })));
};

/** Revoke a stale code approval after any content change. */
const revokeCodeIfApproved = async (skill: AiSkill, actorUserId: string | null, reason: string): Promise<void> => {
  if (!skill.allowCode) return;
  await sql`
    UPDATE ai.skills SET allow_code = FALSE, code_review_requested_at = NULL, updated_at = now()
    WHERE id = ${skill.id}
  `;
  await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId, event: "code_revoked", meta: { reason } });
};

export const aiSkillStore = {
  async create(input: { slug: string; ownerUserId: string | null; actorUserId: string | null }): Promise<AiSkill> {
    const rows = await sql<SkillRow[]>`
      INSERT INTO ai.skills (slug, owner_user_id)
      VALUES (${input.slug}, ${input.ownerUserId})
      RETURNING *
    `;
    const skill = toSkill(rows[0]!);
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "created" });
    return skill;
  },

  async get(skillId: string): Promise<AiSkill | null> {
    const rows = await sql<SkillRow[]>`
      SELECT s.*, convert_from(skill_md_file.bytes, 'UTF8') AS skill_md
      FROM ai.skills s
      LEFT JOIN ai.skill_files skill_md_file ON skill_md_file.skill_id = s.id AND skill_md_file.path = '/SKILL.md'
      WHERE s.id = ${skillId}
    `;
    return rows[0] ? toSkill(rows[0]) : null;
  },

  async getBySlug(slug: string): Promise<AiSkill | null> {
    const rows = await sql<SkillRow[]>`
      SELECT s.*, convert_from(skill_md_file.bytes, 'UTF8') AS skill_md
      FROM ai.skills s
      LEFT JOIN ai.skill_files skill_md_file ON skill_md_file.skill_id = s.id AND skill_md_file.path = '/SKILL.md'
      WHERE s.slug = ${slug}
    `;
    return rows[0] ? toSkill(rows[0]) : null;
  },

  async update(input: { skillId: string; enabled?: boolean; actorUserId: string }): Promise<AiSkill | null> {
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.skills
      SET enabled = COALESCE(${input.enabled ?? null}, enabled),
          updated_at = now()
      WHERE id = ${input.skillId}
      RETURNING id
    `;
    if (!rows[0]) return null;
    const skill = await this.get(input.skillId);
    if (!skill) return null;
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "updated" });
    return skill;
  },

  async delete(input: { skillId: string; actorUserId: string | null }): Promise<boolean> {
    const rows = await sql<{ id: string; slug: string }[]>`
      DELETE FROM ai.skills WHERE id = ${input.skillId} RETURNING id, slug
    `;
    if (!rows[0]) return false;
    await recordEvent({ skillId: rows[0].id, skillSlug: rows[0].slug, actorUserId: input.actorUserId, event: "deleted" });
    return true;
  },

  // ── Files (the skill's tree) ────────────────────────────────────────────

  async listFiles(skillId: string): Promise<AiSkillFileStat[]> {
    const rows = await sql<{ path: string; size: number; media_type: string; updated_at: Date | string }[]>`
      SELECT path, size, media_type, updated_at FROM ai.skill_files WHERE skill_id = ${skillId} ORDER BY path ASC
    `;
    return rows.map((row) => ({ path: row.path, size: Number(row.size), mediaType: row.media_type, updatedAt: iso(row.updated_at) }));
  },

  async readFile(skillId: string, path: string): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
    const rows = await sql<{ bytes: Uint8Array; media_type: string }[]>`
      SELECT bytes, media_type FROM ai.skill_files WHERE skill_id = ${skillId} AND path = ${path}
    `;
    return rows[0] ? { bytes: new Uint8Array(rows[0].bytes ?? []), mediaType: rows[0].media_type } : null;
  },

  async readTree(skillId: string): Promise<AiSkillTreeSnapshot | null> {
    return sql.begin(async (tx) => {
      const skills = await tx<{ id: string }[]>`SELECT id FROM ai.skills WHERE id = ${skillId}`;
      if (!skills[0]) return null;
      const rows = await tx<{ path: string; bytes: Uint8Array; size: number; media_type: string; updated_at: Date | string }[]>`
        SELECT path, bytes, size, media_type, updated_at
        FROM ai.skill_files
        WHERE skill_id = ${skillId}
        ORDER BY path ASC
      `;
      const files = rows.map((row) => ({
        path: row.path,
        bytes: new Uint8Array(row.bytes ?? []),
        size: Number(row.size),
        mediaType: row.media_type,
        updatedAt: iso(row.updated_at),
      }));
      return { skillId, contentHash: hashAiSkillFiles(files), files };
    });
  },

  async replaceTree(input: {
    skillId: string;
    files: AiSkillTreeFile[];
    expectedHash: string;
    prune: boolean;
    actorUserId: string;
  }): Promise<AiSkillTreeReplaceResult> {
    const incoming = new Map<string, AiSkillTreeFile>();
    for (const file of input.files) {
      const path = normalizeAiFilePath(file.path);
      if (!path) throw new Error(`Invalid skill file path: ${file.path}`);
      if (incoming.has(path)) throw new Error(`Duplicate skill file path: ${path}`);
      if (file.bytes.byteLength > AI_SKILL_FILE_MAX_BYTES) {
        throw new Error(`Skill file ${path} exceeds the ${Math.floor(AI_SKILL_FILE_MAX_BYTES / (1024 * 1024))} MB limit.`);
      }
      const mediaType = file.mediaType.trim();
      if (!mediaType || mediaType.length > 120) throw new Error(`Invalid media type for ${path}.`);
      incoming.set(path, { path, bytes: new Uint8Array(file.bytes), mediaType });
    }

    return sql.begin(async (tx): Promise<AiSkillTreeReplaceResult> => {
      const skills = await tx<SkillRow[]>`SELECT * FROM ai.skills WHERE id = ${input.skillId} FOR UPDATE`;
      const skill = skills[0];
      if (!skill) return { ok: false, reason: "not_found" };

      const currentRows = await tx<{
        path: string;
        bytes: Uint8Array;
        size: number;
        media_type: string;
        updated_at: Date | string;
      }[]>`
        SELECT path, bytes, size, media_type, updated_at
        FROM ai.skill_files
        WHERE skill_id = ${input.skillId}
        ORDER BY path ASC
      `;
      const currentFiles = currentRows.map((row) => ({
        path: row.path,
        bytes: new Uint8Array(row.bytes ?? []),
        size: Number(row.size),
        mediaType: row.media_type,
        updatedAt: iso(row.updated_at),
      }));
      const currentHash = hashAiSkillFiles(currentFiles);
      if (currentHash !== input.expectedHash) return { ok: false, reason: "conflict", currentHash };

      const finalFiles = new Map<string, AiSkillTreeFile>();
      if (!input.prune) {
        for (const file of currentFiles) finalFiles.set(file.path, file);
      }
      for (const file of incoming.values()) finalFiles.set(file.path, file);
      if (!finalFiles.has("/SKILL.md")) throw new Error("A skill tree must contain /SKILL.md.");

      const finalSize = [...finalFiles.values()].reduce((total, file) => total + file.bytes.byteLength, 0);
      if (finalSize > AI_SKILL_TOTAL_MAX_BYTES) {
        throw new Error(`Skill exceeds the total size limit of ${Math.floor(AI_SKILL_TOTAL_MAX_BYTES / (1024 * 1024))} MB.`);
      }
      const sortedFinalFiles = [...finalFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
      const contentHash = hashAiSkillFiles(sortedFinalFiles);
      if (contentHash === currentHash) {
        return { ok: true, snapshot: { skillId: input.skillId, contentHash, files: currentFiles } };
      }

      for (const file of incoming.values()) {
        await tx`
          INSERT INTO ai.skill_files (skill_id, path, bytes, media_type, size, updated_at)
          VALUES (${input.skillId}, ${file.path}, ${file.bytes}, ${file.mediaType}, ${file.bytes.byteLength}, now())
          ON CONFLICT (skill_id, path) DO UPDATE SET
            bytes = EXCLUDED.bytes, media_type = EXCLUDED.media_type, size = EXCLUDED.size, updated_at = now()
        `;
      }
      let deletedCount = 0;
      if (input.prune) {
        const deleted = await tx<{ id: string }[]>`
          DELETE FROM ai.skill_files
          WHERE skill_id = ${input.skillId}
            AND path <> ALL(${toPgTextArray([...finalFiles.keys()])}::text[])
          RETURNING id
        `;
        deletedCount = deleted.length;
      }

      await tx`
        UPDATE ai.skills
        SET updated_at = now(),
            allow_code = FALSE,
            code_review_requested_at = CASE WHEN allow_code THEN NULL ELSE code_review_requested_at END
        WHERE id = ${input.skillId}
      `;
      await tx`
        INSERT INTO ai.skill_events (skill_id, skill_slug, actor_user_id, event, meta)
        VALUES (
          ${input.skillId}, ${skill.slug}, ${input.actorUserId}, 'updated',
          ${JSON.stringify({
            operation: "replace_tree",
            prune: input.prune,
            writtenFiles: incoming.size,
            deletedFiles: deletedCount,
            previousHash: currentHash,
            contentHash,
          })}::jsonb
        )
      `;
      if (skill.allow_code) {
        await tx`
          INSERT INTO ai.skill_events (skill_id, skill_slug, actor_user_id, event, meta)
          VALUES (${input.skillId}, ${skill.slug}, ${input.actorUserId}, 'code_revoked', ${JSON.stringify({ reason: "content_changed" })}::jsonb)
        `;
      }

      const updatedRows = await tx<{
        path: string;
        bytes: Uint8Array;
        size: number;
        media_type: string;
        updated_at: Date | string;
      }[]>`
        SELECT path, bytes, size, media_type, updated_at
        FROM ai.skill_files
        WHERE skill_id = ${input.skillId}
        ORDER BY path ASC
      `;
      return {
        ok: true,
        snapshot: {
          skillId: input.skillId,
          contentHash,
          files: updatedRows.map((row) => ({
            path: row.path,
            bytes: new Uint8Array(row.bytes ?? []),
            size: Number(row.size),
            mediaType: row.media_type,
            updatedAt: iso(row.updated_at),
          })),
        },
      };
    });
  },

  async writeFile(input: {
    skillId: string;
    path: string;
    bytes: Uint8Array;
    mediaType?: string;
    /** NULL = platform (e.g. seeding builtin skills). */
    actorUserId: string | null;
  }): Promise<void> {
    if (input.bytes.byteLength > AI_SKILL_FILE_MAX_BYTES) {
      throw new Error(`Skill file exceeds the ${Math.floor(AI_SKILL_FILE_MAX_BYTES / (1024 * 1024))} MB limit.`);
    }
    const totals = await sql<{ total: number | string }[]>`
      SELECT COALESCE(SUM(size), 0) AS total FROM ai.skill_files WHERE skill_id = ${input.skillId} AND path <> ${input.path}
    `;
    if (Number(totals[0]?.total ?? 0) + input.bytes.byteLength > AI_SKILL_TOTAL_MAX_BYTES) {
      throw new Error(`Skill exceeds the total size limit of ${Math.floor(AI_SKILL_TOTAL_MAX_BYTES / (1024 * 1024))} MB.`);
    }
    const skill = await this.get(input.skillId);
    if (!skill) throw new Error("Skill not found.");

    await sql`
      INSERT INTO ai.skill_files (skill_id, path, bytes, media_type, size, updated_at)
      VALUES (${input.skillId}, ${input.path}, ${input.bytes}, ${input.mediaType ?? "text/markdown"}, ${input.bytes.byteLength}, now())
      ON CONFLICT (skill_id, path) DO UPDATE SET
        bytes = EXCLUDED.bytes, media_type = EXCLUDED.media_type, size = EXCLUDED.size, updated_at = now()
    `;
    await sql`UPDATE ai.skills SET updated_at = now() WHERE id = ${input.skillId}`;
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "updated", meta: { path: input.path } });
    await revokeCodeIfApproved(skill, input.actorUserId, "content_changed");
  },

  async deleteFile(input: { skillId: string; path: string; actorUserId: string }): Promise<boolean> {
    const skill = await this.get(input.skillId);
    if (!skill) return false;
    const rows = await sql<{ id: string }[]>`
      DELETE FROM ai.skill_files WHERE skill_id = ${input.skillId} AND path = ${input.path} RETURNING id
    `;
    if (rows.length === 0) return false;
    await sql`UPDATE ai.skills SET updated_at = now() WHERE id = ${input.skillId}`;
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "updated", meta: { deleted: input.path } });
    await revokeCodeIfApproved(skill, input.actorUserId, "content_changed");
    return true;
  },

  // ── Per-user activation (consent) ───────────────────────────────────────

  async setUserState(input: { userId: string; skillId: string; state: "enabled" | "disabled" }): Promise<void> {
    const skill = await this.get(input.skillId);
    if (!skill) throw new Error("Skill not found.");
    await sql`
      INSERT INTO ai.skill_user_state (user_id, skill_id, state, updated_at)
      VALUES (${input.userId}, ${input.skillId}, ${input.state}, now())
      ON CONFLICT (user_id, skill_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
    `;
    await recordEvent({
      skillId: skill.id,
      skillSlug: skill.slug,
      actorUserId: input.userId,
      event: input.state === "enabled" ? "enabled" : "disabled",
      meta: { scope: "user" },
    });
  },

  // ── Visibility & catalog ────────────────────────────────────────────────

  /**
   * Every skill the user may see: own, workspace-owned, or shared via the
   * standard access system (direct user grant, group grant, authenticated).
   * Default activation encodes the consent rule: own + workspace = enabled,
   * foreign shares = disabled until the user explicitly enables them.
   */
  async visibleSkills(input: { userId: string; userGroups: string[] }): Promise<AiSkillUserView[]> {
    const rows = await sql<(SkillRow & { user_state: string | null })[]>`
      SELECT s.*, st.state AS user_state, convert_from(skill_md_file.bytes, 'UTF8') AS skill_md
      FROM ai.skills s
      LEFT JOIN ai.skill_user_state st ON st.skill_id = s.id AND st.user_id = ${input.userId}
      LEFT JOIN ai.skill_files skill_md_file ON skill_md_file.skill_id = s.id AND skill_md_file.path = '/SKILL.md'
      WHERE s.owner_user_id = ${input.userId}
        OR s.owner_user_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM ai.skill_access sa
          JOIN auth.access a ON a.id = sa.access_id
          WHERE sa.skill_id = s.id
            AND (
              a.user_id = ${input.userId}::uuid
              OR a.group_id = ANY(${toPgUuidArray(input.userGroups)}::uuid[])
              OR a.authenticated_only = TRUE
            )
        )
      ORDER BY s.slug ASC
    `;
    return rows.map((row) => {
      const skill = toSkill(row);
      const origin: AiSkillOrigin = skill.ownerUserId === input.userId ? "own" : skill.ownerUserId === null ? "workspace" : "shared";
      const defaultState = origin === "shared" ? "disabled" : "enabled";
      const userState = row.user_state === "enabled" || row.user_state === "disabled" ? row.user_state : defaultState;
      return { ...skill, origin, userState };
    });
  },

  /** Skills that actually enter the user's catalog and /skills mount. */
  async activeSkills(input: { userId: string; userGroups: string[] }): Promise<AiSkillUserView[]> {
    const visible = await this.visibleSkills(input);
    return visible.filter((skill) => skill.enabled && skill.userState === "enabled");
  },

  // ── Sharing (standard access system, junction table) ───────────────────

  async listAccess(skillId: string): Promise<AccessEntry[]> {
    const rows = await sql<
      { id: string; user_id: string | null; group_id: string | null; service_account_id: string | null; authenticated_only: boolean; permission: PermissionLevel; created_at: Date | string }[]
    >`
      SELECT a.id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only, a.permission, a.created_at
      FROM ai.skill_access sa
      JOIN auth.access a ON a.id = sa.access_id
      WHERE sa.skill_id = ${skillId}
      ORDER BY a.created_at ASC
    `;
    const entries: AccessEntry[] = rows.map((row) => ({
      id: row.id,
      permission: row.permission,
      createdAt: iso(row.created_at),
      principal: row.user_id
        ? { type: "user", userId: row.user_id }
        : row.group_id
          ? { type: "group", groupId: row.group_id }
          : row.service_account_id
            ? { type: "service_account", serviceAccountId: row.service_account_id }
            : row.authenticated_only
              ? { type: "authenticated" }
              : { type: "public" },
    }));
    return resolveDisplayNames(entries);
  },

  async grantAccess(input: {
    skillId: string;
    principal: Principal;
    permission: PermissionLevel;
    actorUserId: string;
  }): Promise<AccessEntry | null> {
    const skill = await this.get(input.skillId);
    if (!skill) return null;
    const created = await createAccess({ principal: input.principal, permission: input.permission });
    if (!created.ok) throw new Error(created.error.message);
    await sql`INSERT INTO ai.skill_access (skill_id, access_id) VALUES (${input.skillId}, ${created.data.id}) ON CONFLICT DO NOTHING`;
    await recordEvent({
      skillId: skill.id,
      skillSlug: skill.slug,
      actorUserId: input.actorUserId,
      event: "shared",
      meta: { principal: input.principal.type, permission: input.permission },
    });
    const entries = await this.listAccess(input.skillId);
    return entries.find((entry) => entry.id === created.data.id) ?? null;
  },

  async revokeAccess(input: { skillId: string; accessId: string; actorUserId: string }): Promise<boolean> {
    const skill = await this.get(input.skillId);
    if (!skill) return false;
    const rows = await sql<{ access_id: string }[]>`
      DELETE FROM ai.skill_access WHERE skill_id = ${input.skillId} AND access_id = ${input.accessId} RETURNING access_id
    `;
    if (rows.length === 0) return false;
    await deleteAccess({ id: input.accessId });
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "unshared" });
    return true;
  },

  // ── Code review lifecycle ───────────────────────────────────────────────

  async requestCodeReview(input: { skillId: string; actorUserId: string }): Promise<void> {
    const skill = await this.get(input.skillId);
    if (!skill) throw new Error("Skill not found.");
    await sql`UPDATE ai.skills SET code_review_requested_at = now(), updated_at = updated_at WHERE id = ${input.skillId}`;
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "code_review_requested" });
  },

  /** Approve code execution — binds to the current content hash of the whole tree. */
  async approveCode(input: { skillId: string; approverUserId: string }): Promise<AiSkill | null> {
    const skill = await this.get(input.skillId);
    if (!skill) return null;
    const hash = await computeAiSkillContentHash(input.skillId);
    const rows = await sql<{ id: string }[]>`
      UPDATE ai.skills
      SET allow_code = TRUE,
          code_approved_by = ${input.approverUserId},
          code_approved_at = now(),
          code_approved_hash = ${hash},
          code_review_requested_at = NULL,
          updated_at = now()
      WHERE id = ${input.skillId}
      RETURNING id
    `;
    await recordEvent({
      skillId: skill.id,
      skillSlug: skill.slug,
      actorUserId: input.approverUserId,
      event: "code_approved",
      meta: { hash },
    });
    return rows[0] ? this.get(input.skillId) : null;
  },

  async revokeCode(input: { skillId: string; actorUserId: string }): Promise<void> {
    const skill = await this.get(input.skillId);
    if (!skill) throw new Error("Skill not found.");
    await sql`UPDATE ai.skills SET allow_code = FALSE, code_review_requested_at = NULL, updated_at = now() WHERE id = ${input.skillId}`;
    await recordEvent({ skillId: skill.id, skillSlug: skill.slug, actorUserId: input.actorUserId, event: "code_revoked", meta: { reason: "manual" } });
  },

  /** Workspace skills waiting for a code review (admin queue, oldest first, capped). */
  async listCodeReviewQueue(): Promise<AiSkill[]> {
    const rows = await sql<SkillRow[]>`
      SELECT s.*, convert_from(skill_md_file.bytes, 'UTF8') AS skill_md
      FROM ai.skills s
      LEFT JOIN ai.skill_files skill_md_file ON skill_md_file.skill_id = s.id AND skill_md_file.path = '/SKILL.md'
      WHERE s.code_review_requested_at IS NOT NULL
      ORDER BY s.code_review_requested_at ASC
      LIMIT 100
    `;
    return rows.map(toSkill);
  },

  /**
   * Full registry (admin surface): slug-keyset paginated, optional search over
   * slug and SKILL.md content (description lives there). `workspaceOnly`
   * filters BEFORE pagination so pages stay full-sized.
   */
  async listAll(input?: {
    q?: string;
    limit?: number;
    afterSlug?: string;
    workspaceOnly?: boolean;
  }): Promise<{ skills: AiSkill[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const pattern = input?.q?.trim() ? `%${escapeLikePattern(input.q.trim())}%` : null;
    const rows = await sql<SkillRow[]>`
      SELECT s.*, convert_from(skill_md_file.bytes, 'UTF8') AS skill_md
      FROM ai.skills s
      LEFT JOIN ai.skill_files skill_md_file ON skill_md_file.skill_id = s.id AND skill_md_file.path = '/SKILL.md'
      WHERE (${input?.afterSlug ?? null}::text IS NULL OR s.slug > ${input?.afterSlug ?? null})
        AND (${input?.workspaceOnly ?? false} = FALSE OR s.owner_user_id IS NULL)
        AND (
          ${pattern}::text IS NULL
          OR s.slug ILIKE ${pattern}
          OR convert_from(skill_md_file.bytes, 'UTF8') ILIKE ${pattern}
        )
      ORDER BY s.slug ASC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit).map(toSkill);
    return { skills: page, nextCursor: rows.length > limit ? (page.at(-1)?.slug ?? null) : null };
  },

  // ── Audit log ───────────────────────────────────────────────────────────

  /**
   * Newest-first, keyset-paginated on (created_at, id): `before` is the last
   * event of the previous page, `nextCursor` is null when the log is
   * exhausted. Offset pagination would skip/duplicate rows while new events
   * arrive — an audit log must not do either.
   */
  async listEvents(input: {
    skillId?: string;
    limit?: number;
    before?: { createdAt: string; id: string };
  }): Promise<{ events: AiSkillEvent[]; nextCursor: { createdAt: string; id: string } | null }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await sql<
      {
        id: string;
        skill_id: string;
        skill_slug: string;
        actor_user_id: string | null;
        actor_display_name: string | null;
        event: AiSkillEventKind;
        meta: unknown;
        created_at: Date | string;
      }[]
    >`
      SELECT e.*, u.display_name AS actor_display_name
      FROM ai.skill_events e
      LEFT JOIN auth.users u ON u.id = e.actor_user_id
      WHERE (${input.skillId ?? null}::uuid IS NULL OR e.skill_id = ${input.skillId ?? null})
        AND (
          ${input.before?.createdAt ?? null}::timestamptz IS NULL
          OR (e.created_at, e.id) < (${input.before?.createdAt ?? null}::timestamptz, ${input.before?.id ?? null}::uuid)
        )
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const events = page.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      skillSlug: row.skill_slug,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      event: row.event,
      meta: toJsonRecord(row.meta),
      createdAt: iso(row.created_at),
    }));
    const last = events.at(-1);
    return { events, nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  },
};
