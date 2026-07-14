/**
 * AI skills API — the user-facing catalog (own/workspace/shared skills,
 * consent state, sharing) and the admin surface (workspace skills, code
 * review queue, audit events). Mounted by the core API under /ai/skills.
 *
 * Rights model:
 * - manage = skill owner, or platform admin for workspace skills (owner NULL)
 * - visible = own, workspace, or shared via the standard access system
 * - code (allow_code) exists only on workspace skills and is admin-approved,
 *   bound to the content hash — any file change revokes it in the store.
 */
import { type Context, Hono } from "hono";
import { z } from "zod";
import { hasRole, type User } from "../contracts/shared";
import { type AuthContext, auth, err, fail, ok, rateLimit, respond, v } from "../server";
import { PERMISSION_LEVELS, type Principal, updateAccess } from "../server/services/access";
import { guessAiMediaType, normalizeAiFilePath } from "./files-store";
import { AI_SKILL_SLUG_RE, type AiSkill, aiSkillStore } from "./skills-store";

const SKILL_STARTER_TEMPLATE = (slug: string, description: string) => `---
name: ${slug}
description: ${description}
---

# ${slug}

Describe here when this skill applies and how the assistant should use it.
Add reference material under references/ and reusable assets under assets/.
`;

const CreateSkillSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(AI_SKILL_SLUG_RE, "Use lowercase letters, digits and hyphens, starting with a letter or digit."),
  /** Optional — only seeds the SKILL.md frontmatter template. */
  description: z.string().trim().max(500).optional(),
  /** Admin only: create a workspace skill (owner NULL, may later run code). */
  workspace: z.boolean().optional(),
});

const UpdateSkillSchema = z.object({
  enabled: z.boolean().optional(),
});

const SkillFilePathQuerySchema = z.object({ path: z.string().min(1) });

const WriteSkillFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(4 * 1024 * 1024),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  mediaType: z.string().max(120).optional(),
});

const ReplaceSkillTreeSchema = z.object({
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 content hash."),
  prune: z.boolean().default(false),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string().max(3 * 1024 * 1024),
        encoding: z.enum(["utf8", "base64"]).default("base64"),
        mediaType: z.string().min(1).max(120).optional(),
      }),
    )
    .max(1_000),
});

const UserStateSchema = z.object({ state: z.enum(["enabled", "disabled"]) });

const PrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string().min(1) }),
  z.object({ type: z.literal("group"), groupId: z.string().min(1) }),
  z.object({ type: z.literal("authenticated") }),
]);

const GrantAccessSchema = z.object({
  principal: PrincipalSchema,
  permission: z.enum(PERMISSION_LEVELS.filter((level) => level !== "none") as ["read", "write", "admin"]).default("read"),
});

const UpdateAccessSchema = z.object({
  permission: z.enum(PERMISSION_LEVELS.filter((level) => level !== "none") as ["read", "write", "admin"]),
});

const AdminSkillsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  afterSlug: z.string().max(64).optional(),
  workspaceOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const EventsQuerySchema = z.object({
  skillId: z.string().optional(),
  // Matches the store clamp — a bigger number here would silently shrink.
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Keyset cursor: created_at + id of the last event of the previous page. */
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeId: z.uuid().optional(),
});

/** Media types the explorer edits as text; everything else travels base64. */
const isTextMediaType = (mediaType: string): boolean =>
  mediaType.startsWith("text/") ||
  ["application/json", "application/yaml", "application/xml", "image/svg+xml"].includes(mediaType);

const decodeTreeFile = (content: string, encoding: "utf8" | "base64"): Uint8Array => {
  if (encoding === "utf8") return new TextEncoder().encode(content);
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error("Invalid base64 skill file content.");
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content) throw new Error("Invalid base64 skill file content.");
  return new Uint8Array(bytes);
};

const requestUser = (c: Context<AuthContext>): User | null => {
  const actor = c.get("actor");
  if (!actor) return null;
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const canManageSkill = (skill: AiSkill, user: User): boolean =>
  skill.ownerUserId === user.id || (skill.ownerUserId === null && hasRole(user, "admin"));

const isSkillVisibleTo = async (skill: AiSkill, user: User): Promise<boolean> => {
  if (skill.ownerUserId === user.id || skill.ownerUserId === null) return true;
  const visible = await aiSkillStore.visibleSkills({ userId: user.id });
  return visible.some((entry) => entry.id === skill.id);
};

export const createAiSkillsRoutes = () => {
  /** Load skill + user, enforcing visibility; managed=true additionally requires manage rights. */
  const loadSkill = async (
    c: Context<AuthContext>,
    options?: { manage?: boolean },
  ): Promise<{ skill: AiSkill; user: User } | Response> => {
    const user = requestUser(c);
    if (!user) return (await respond(c, fail(err.forbidden("Skills require a user-backed actor")))) as unknown as Response;
    const skill = await aiSkillStore.get(c.req.param("skillId") ?? "");
    if (!skill) return (await respond(c, fail(err.notFound("Skill")))) as unknown as Response;
    if (options?.manage) {
      if (!canManageSkill(skill, user)) return (await respond(c, fail(err.forbidden("You cannot manage this skill")))) as unknown as Response;
    } else if (!(await isSkillVisibleTo(skill, user)) || (!skill.enabled && !canManageSkill(skill, user))) {
      // Admin-disabled skills are fully gone for users — not "visible but off".
      return (await respond(c, fail(err.notFound("Skill")))) as unknown as Response;
    }
    return { skill, user };
  };

  return (
    new Hono<AuthContext>()
      .use(rateLimit())
      .use("*", auth.requireRole("authenticated"))

      // ── Admin surface (static paths before :skillId params) ────────────
      .get("/admin/all", auth.requireRole("admin"), v("query", AdminSkillsQuerySchema), async (c) => {
        const { q, limit, afterSlug, workspaceOnly } = c.req.valid("query");
        return respond(c, ok(await aiSkillStore.listAll({ q, limit, afterSlug, workspaceOnly })));
      })
      .get("/admin/review-queue", auth.requireRole("admin"), async (c) =>
        respond(c, ok({ skills: await aiSkillStore.listCodeReviewQueue() })),
      )
      .get("/admin/events", auth.requireRole("admin"), v("query", EventsQuerySchema), async (c) => {
        const { skillId, limit, beforeCreatedAt, beforeId } = c.req.valid("query");
        const before = beforeCreatedAt && beforeId ? { createdAt: beforeCreatedAt, id: beforeId } : undefined;
        return respond(c, ok(await aiSkillStore.listEvents({ skillId, limit, before })));
      })

      // ── Catalog ─────────────────────────────────────────────────────────
      .get("/", async (c) => {
        const user = requestUser(c);
        if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
        const visible = await aiSkillStore.visibleSkills({ userId: user.id });
        // Admin-disabled skills leave the user catalog entirely (admins manage
        // them on the dedicated admin page, which lists via /admin/all).
        return respond(c, ok({ skills: visible.filter((skill) => skill.enabled) }));
      })
      .get("/managed", async (c) => {
        const user = requestUser(c);
        if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
        const visible = await aiSkillStore.visibleSkills({ userId: user.id });
        return respond(c, ok({ skills: visible.filter((skill) => canManageSkill(skill, user)) }));
      })
      .post("/", v("json", CreateSkillSchema), async (c) => {
        const user = requestUser(c);
        if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
        const input = c.req.valid("json");
        if (input.workspace && !hasRole(user, "admin")) {
          return respond(c, fail(err.forbidden("Only admins can create workspace skills")));
        }
        if (await aiSkillStore.getBySlug(input.slug)) return respond(c, fail(err.conflict(`Skill "${input.slug}"`)));
        // The description only seeds the SKILL.md template — frontmatter stays the single source of truth.
        const skill = await aiSkillStore.create({
          slug: input.slug,
          ownerUserId: input.workspace ? null : user.id,
          actorUserId: user.id,
        });
        await aiSkillStore.writeFile({
          skillId: skill.id,
          path: "/SKILL.md",
          bytes: new TextEncoder().encode(SKILL_STARTER_TEMPLATE(skill.slug, input.description || "Describe when this skill applies.")),
          mediaType: "text/markdown",
          actorUserId: user.id,
        });
        return respond(c, ok({ skill }));
      })

      // ── Skill detail & lifecycle ────────────────────────────────────────
      .get("/:skillId", async (c) => {
        const loaded = await loadSkill(c);
        if (loaded instanceof Response) return loaded;
        const [files, views] = await Promise.all([
          aiSkillStore.listFiles(loaded.skill.id),
          aiSkillStore.visibleSkills({ userId: loaded.user.id }),
        ]);
        const view = views.find((entry) => entry.id === loaded.skill.id);
        return respond(
          c,
          ok({
            skill: view ?? loaded.skill,
            files,
            canManage: canManageSkill(loaded.skill, loaded.user),
          }),
        );
      })
      .patch("/:skillId", v("json", UpdateSkillSchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const input = c.req.valid("json");
        const skill = await aiSkillStore.update({ skillId: loaded.skill.id, ...input, actorUserId: loaded.user.id });
        return respond(c, ok({ skill }));
      })
      .delete("/:skillId", async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        await aiSkillStore.delete({ skillId: loaded.skill.id, actorUserId: loaded.user.id });
        return respond(c, ok({ deleted: true }));
      })

      // ── Files (SkillExplorer) ───────────────────────────────────────────
      .get("/:skillId/tree", async (c) => {
        const loaded = await loadSkill(c);
        if (loaded instanceof Response) return loaded;
        const snapshot = await aiSkillStore.readTree(loaded.skill.id);
        if (!snapshot) return respond(c, fail(err.notFound("Skill")));
        return respond(
          c,
          ok({
            skill: loaded.skill,
            contentHash: snapshot.contentHash,
            files: snapshot.files.map((file) => ({
              path: file.path,
              size: file.size,
              mediaType: file.mediaType,
              updatedAt: file.updatedAt,
              encoding: "base64" as const,
              content: Buffer.from(file.bytes).toString("base64"),
            })),
          }),
        );
      })
      .put("/:skillId/tree", v("json", ReplaceSkillTreeSchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const input = c.req.valid("json");
        try {
          const result = await aiSkillStore.replaceTree({
            skillId: loaded.skill.id,
            expectedHash: input.expectedHash,
            prune: input.prune,
            actorUserId: loaded.user.id,
            files: input.files.map((file) => ({
              path: file.path,
              bytes: decodeTreeFile(file.content, file.encoding),
              mediaType: file.mediaType ?? guessAiMediaType(file.path),
            })),
          });
          if (!result.ok) {
            if (result.reason === "not_found") return respond(c, fail(err.notFound("Skill")));
            return respond(c, fail(err.conflict("Skill tree changed. Refresh it before pushing again.")));
          }
          return respond(
            c,
            ok({
              contentHash: result.snapshot.contentHash,
              files: result.snapshot.files.map(({ bytes: _bytes, ...file }) => file),
            }),
          );
        } catch (error) {
          return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Failed to replace skill tree")));
        }
      })
      .get("/:skillId/file", v("query", SkillFilePathQuerySchema), async (c) => {
        const loaded = await loadSkill(c);
        if (loaded instanceof Response) return loaded;
        const path = normalizeAiFilePath(c.req.valid("query").path);
        if (!path) return respond(c, fail(err.badInput("Invalid file path")));
        const file = await aiSkillStore.readFile(loaded.skill.id, path);
        if (!file) return respond(c, fail(err.notFound("Skill file")));
        const text = isTextMediaType(file.mediaType);
        return respond(
          c,
          ok({
            path,
            mediaType: file.mediaType,
            size: file.bytes.byteLength,
            encoding: text ? ("utf8" as const) : ("base64" as const),
            content: text ? new TextDecoder().decode(file.bytes) : Buffer.from(file.bytes).toString("base64"),
          }),
        );
      })
      .put("/:skillId/file", v("json", WriteSkillFileSchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const input = c.req.valid("json");
        const path = normalizeAiFilePath(input.path);
        if (!path) return respond(c, fail(err.badInput("Invalid file path")));
        const bytes = input.encoding === "base64" ? new Uint8Array(Buffer.from(input.content, "base64")) : new TextEncoder().encode(input.content);
        try {
          await aiSkillStore.writeFile({
            skillId: loaded.skill.id,
            path,
            bytes,
            mediaType: input.mediaType ?? guessAiMediaType(path),
            actorUserId: loaded.user.id,
          });
        } catch (error) {
          return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Failed to write skill file")));
        }
        return respond(c, ok({ files: await aiSkillStore.listFiles(loaded.skill.id) }));
      })
      .delete("/:skillId/file", v("query", SkillFilePathQuerySchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const path = normalizeAiFilePath(c.req.valid("query").path);
        if (!path) return respond(c, fail(err.badInput("Invalid file path")));
        const deleted = await aiSkillStore.deleteFile({ skillId: loaded.skill.id, path, actorUserId: loaded.user.id });
        if (!deleted) return respond(c, fail(err.notFound("Skill file")));
        return respond(c, ok({ files: await aiSkillStore.listFiles(loaded.skill.id) }));
      })

      // ── Per-user activation (consent) ───────────────────────────────────
      .put("/:skillId/state", v("json", UserStateSchema), async (c) => {
        const loaded = await loadSkill(c);
        if (loaded instanceof Response) return loaded;
        await aiSkillStore.setUserState({ userId: loaded.user.id, skillId: loaded.skill.id, state: c.req.valid("json").state });
        return respond(c, ok({ state: c.req.valid("json").state }));
      })

      // ── Sharing (standard access system) ────────────────────────────────
      .get("/:skillId/access", async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        return respond(c, ok({ entries: await aiSkillStore.listAccess(loaded.skill.id) }));
      })
      .post("/:skillId/access", v("json", GrantAccessSchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const input = c.req.valid("json");
        const entry = await aiSkillStore.grantAccess({
          skillId: loaded.skill.id,
          principal: input.principal as Principal,
          permission: input.permission,
          actorUserId: loaded.user.id,
        });
        if (!entry) return respond(c, fail(err.notFound("Skill")));
        return respond(c, ok({ entry }));
      })
      .patch("/:skillId/access/:accessId", v("json", UpdateAccessSchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const accessId = c.req.param("accessId") ?? "";
        const entries = await aiSkillStore.listAccess(loaded.skill.id);
        if (!entries.some((entry) => entry.id === accessId)) return respond(c, fail(err.notFound("Access entry")));
        const result = await updateAccess({ id: accessId, permission: c.req.valid("json").permission });
        if (!result.ok) return respond(c, fail(err.badInput(result.error.message)));
        return respond(c, ok({ updated: true }));
      })
      .delete("/:skillId/access/:accessId", async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const revoked = await aiSkillStore.revokeAccess({
          skillId: loaded.skill.id,
          accessId: c.req.param("accessId") ?? "",
          actorUserId: loaded.user.id,
        });
        if (!revoked) return respond(c, fail(err.notFound("Access entry")));
        return respond(c, ok({ revoked: true }));
      })

      // ── Code review lifecycle (workspace skills only) ───────────────────
      .post("/:skillId/code-review", async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        if (loaded.skill.ownerUserId !== null) {
          return respond(c, fail(err.badInput("Only workspace skills can run code — user skills are content-only.")));
        }
        await aiSkillStore.requestCodeReview({ skillId: loaded.skill.id, actorUserId: loaded.user.id });
        return respond(c, ok({ requested: true }));
      })
      .post("/:skillId/code-approve", auth.requireRole("admin"), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        if (loaded.skill.ownerUserId !== null) {
          return respond(c, fail(err.badInput("Only workspace skills can run code — user skills are content-only.")));
        }
        const skill = await aiSkillStore.approveCode({ skillId: loaded.skill.id, approverUserId: loaded.user.id });
        return respond(c, ok({ skill }));
      })
      .post("/:skillId/code-revoke", auth.requireRole("admin"), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        await aiSkillStore.revokeCode({ skillId: loaded.skill.id, actorUserId: loaded.user.id });
        return respond(c, ok({ revoked: true }));
      })
      .get("/:skillId/events", v("query", EventsQuerySchema), async (c) => {
        const loaded = await loadSkill(c, { manage: true });
        if (loaded instanceof Response) return loaded;
        const { limit, beforeCreatedAt, beforeId } = c.req.valid("query");
        const before = beforeCreatedAt && beforeId ? { createdAt: beforeCreatedAt, id: beforeId } : undefined;
        return respond(c, ok(await aiSkillStore.listEvents({ skillId: loaded.skill.id, limit: limit ?? 50, before })));
      })
  );
};

export type AiSkillsRoutes = ReturnType<typeof createAiSkillsRoutes>;
