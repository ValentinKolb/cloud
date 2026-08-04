import { type Context, Hono } from "hono";
import { z } from "zod";
import type { User } from "../contracts/shared";
import { type ApiErrorResponse, type AuthContext, auth, err, fail, ok, rateLimit, respond, v } from "../server";
import {
  AI_SKILL_DESCRIPTION_MAX_CHARS,
  AI_SKILL_INSTRUCTIONS_MAX_CHARS,
  AI_SKILL_NAME_MAX_CHARS,
  type AiSkill,
  aiSkillStore,
} from "./skills-store";

const SkillNameSchema = z.string().trim().min(1).max(AI_SKILL_NAME_MAX_CHARS);
const SkillDescriptionSchema = z.string().trim().max(AI_SKILL_DESCRIPTION_MAX_CHARS);
const SkillInstructionsSchema = z.string().trim().min(1).max(AI_SKILL_INSTRUCTIONS_MAX_CHARS);

const SkillFieldsSchema = z.object({
  name: SkillNameSchema,
  description: SkillDescriptionSchema.default(""),
  instructions: SkillInstructionsSchema,
});

const UpdateSkillSchema = z
  .object({
    name: SkillNameSchema.optional(),
    description: SkillDescriptionSchema.optional(),
    instructions: SkillInstructionsSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "No changes supplied.");

const UpdateWorkspaceSkillSchema = z
  .object({
    name: SkillNameSchema.optional(),
    description: SkillDescriptionSchema.optional(),
    instructions: SkillInstructionsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "No changes supplied.");

const requestUser = (c: Context<AuthContext>): User | null => {
  const actor = c.get("actor");
  if (!actor) return null;
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";

const conflictName = (c: Context<AuthContext>) => respond(c, fail(err.conflict("A skill with this name already exists.")));

export const canMutateAiSkillInUserRoutes = (skill: AiSkill, userId: string): boolean =>
  skill.scope === "personal" && skill.ownerUserId === userId;

export const createAiSkillsRoutes = () => {
  const loadPersonalSkill = async (c: Context<AuthContext>): Promise<{ skill: AiSkill; user: User } | ApiErrorResponse> => {
    const user = requestUser(c);
    if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
    const skill = await aiSkillStore.get(c.req.param("skillId") ?? "");
    if (!skill || !canMutateAiSkillInUserRoutes(skill, user.id)) {
      return respond(c, fail(err.notFound("Skill")));
    }
    return { skill, user };
  };

  const loadWorkspaceSkill = async (c: Context<AuthContext>): Promise<AiSkill | ApiErrorResponse> => {
    const skill = await aiSkillStore.get(c.req.param("skillId") ?? "");
    if (!skill || skill.scope !== "workspace") return respond(c, fail(err.notFound("Skill")));
    return skill;
  };

  return new Hono<AuthContext>()
    .use(rateLimit())
    .use("*", auth.requireRole("authenticated"))

    .get("/admin", auth.requireRole("admin"), async (c) => respond(c, ok({ skills: await aiSkillStore.listWorkspace() })))
    .post("/admin", auth.requireRole("admin"), v("json", SkillFieldsSchema), async (c) => {
      try {
        const skill = await aiSkillStore.create({
          ...c.req.valid("json"),
          scope: "workspace",
          ownerUserId: null,
        });
        return respond(c, ok({ skill }));
      } catch (error) {
        if (isUniqueViolation(error)) return conflictName(c);
        throw error;
      }
    })
    .get("/admin/:skillId", auth.requireRole("admin"), async (c) => {
      const skill = await loadWorkspaceSkill(c);
      if (skill instanceof Response) return skill;
      return respond(c, ok({ skill }));
    })
    .patch("/admin/:skillId", auth.requireRole("admin"), v("json", UpdateWorkspaceSkillSchema), async (c) => {
      const skill = await loadWorkspaceSkill(c);
      if (skill instanceof Response) return skill;
      try {
        const updated = await aiSkillStore.update({ skillId: skill.id, ...c.req.valid("json") });
        return updated ? respond(c, ok({ skill: updated })) : respond(c, fail(err.notFound("Skill")));
      } catch (error) {
        if (isUniqueViolation(error)) return conflictName(c);
        throw error;
      }
    })
    .delete("/admin/:skillId", auth.requireRole("admin"), async (c) => {
      const skill = await loadWorkspaceSkill(c);
      if (skill instanceof Response) return skill;
      await aiSkillStore.delete(skill.id);
      return respond(c, ok({ deleted: true }));
    })

    .get("/", async (c) => {
      const user = requestUser(c);
      if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
      return respond(c, ok({ skills: await aiSkillStore.listVisible({ userId: user.id }) }));
    })
    .post("/", v("json", SkillFieldsSchema), async (c) => {
      const user = requestUser(c);
      if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
      try {
        const skill = await aiSkillStore.create({ ...c.req.valid("json"), scope: "personal", ownerUserId: user.id });
        return respond(c, ok({ skill }));
      } catch (error) {
        if (isUniqueViolation(error)) return conflictName(c);
        throw error;
      }
    })
    .get("/:skillId", async (c) => {
      const user = requestUser(c);
      if (!user) return respond(c, fail(err.forbidden("Skills require a user-backed actor")));
      const skill = await aiSkillStore.getVisible({ skillId: c.req.param("skillId"), userId: user.id });
      return skill ? respond(c, ok({ skill })) : respond(c, fail(err.notFound("Skill")));
    })
    .patch("/:skillId", v("json", UpdateSkillSchema), async (c) => {
      const loaded = await loadPersonalSkill(c);
      if (loaded instanceof Response) return loaded;
      try {
        const skill = await aiSkillStore.update({ skillId: loaded.skill.id, ...c.req.valid("json") });
        return skill ? respond(c, ok({ skill })) : respond(c, fail(err.notFound("Skill")));
      } catch (error) {
        if (isUniqueViolation(error)) return conflictName(c);
        throw error;
      }
    })
    .delete("/:skillId", async (c) => {
      const loaded = await loadPersonalSkill(c);
      if (loaded instanceof Response) return loaded;
      await aiSkillStore.delete(loaded.skill.id);
      return respond(c, ok({ deleted: true }));
    });
};

export type AiSkillsRoutes = ReturnType<typeof createAiSkillsRoutes>;
