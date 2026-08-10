import { Hono } from "hono";
import { z } from "zod";
import { PrincipalSchema } from "../contracts/shared";
import { type AuthContext, auth, err, fail, ok, rateLimit, respond, v } from "../server";
import { decodeAiFileContent } from "./files-store";
import {
  AI_PROJECT_DESCRIPTION_MAX_CHARS,
  AI_PROJECT_FILE_MAX_BYTES,
  AI_PROJECT_INSTRUCTIONS_MAX_CHARS,
  AI_PROJECT_KNOWLEDGE_MAX_CHARS,
  AI_PROJECT_NAME_MAX_CHARS,
  aiProjects,
} from "./projects";

const ProjectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(AI_PROJECT_NAME_MAX_CHARS),
  description: z.string().trim().max(AI_PROJECT_DESCRIPTION_MAX_CHARS).default(""),
  icon: z.string().trim().min(1).max(80).default("ti ti-folders"),
  instructions: z.string().trim().max(AI_PROJECT_INSTRUCTIONS_MAX_CHARS).default(""),
  defaultModelProfileId: z.string().trim().min(1).max(120).nullable().optional(),
});

const UpdateProjectSchema = ProjectFieldsSchema.partial().refine((input) => Object.keys(input).length > 0, "No changes supplied.");
const ProjectAccessSchema = z.object({ principal: PrincipalSchema, permission: z.enum(["read", "write", "admin"]) });
const ProjectAccessUpdateSchema = z.object({ permission: z.enum(["read", "write", "admin"]) });
const KnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(AI_PROJECT_KNOWLEDGE_MAX_CHARS),
});
const UpdateKnowledgeSchema = KnowledgeSchema.partial().refine((input) => Object.keys(input).length > 0, "No changes supplied.");
const KnowledgeQuerySchema = z.object({ q: z.string().trim().max(200).optional() });
const ProjectFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  mediaType: z.string().trim().min(1).max(120).default("application/octet-stream"),
  content: z.string().max(Math.ceil((AI_PROJECT_FILE_MAX_BYTES * 4) / 3) + 4),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
const ReferenceSchema = z.object({
  appId: z.string().trim().min(1).max(120),
  resourceType: z.string().trim().min(1).max(120),
  resourceId: z.string().trim().min(1).max(500),
  label: z.string().trim().max(200).default(""),
});

const notFound = (c: Parameters<typeof respond>[0], noun = "Project") => respond(c, fail(err.notFound(noun)));

export const createAiProjectsRoutes = () =>
  new Hono<AuthContext>()
    .use(rateLimit())
    .use("*", auth.requireRole("authenticated"))
    .get("/", async (c) => respond(c, ok({ projects: await aiProjects.list(c.get("accessSubject")) })))
    .post("/", v("json", ProjectFieldsSchema), async (c) => {
      try {
        return respond(c, ok({ project: await aiProjects.create({ subject: c.get("accessSubject"), ...c.req.valid("json") }) }), 201);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
          return respond(c, fail(err.conflict("A project with this name already exists.")));
        }
        throw error;
      }
    })
    .get("/:projectId", async (c) => {
      const project = await aiProjects.get(c.req.param("projectId")!, c.get("accessSubject"));
      return project ? respond(c, ok({ project })) : notFound(c);
    })
    .patch("/:projectId", v("json", UpdateProjectSchema), async (c) => {
      const project = await aiProjects.update(c.req.param("projectId")!, c.get("accessSubject"), c.req.valid("json"));
      return project ? respond(c, ok({ project })) : notFound(c);
    })
    .delete("/:projectId", async (c) =>
      (await aiProjects.delete(c.req.param("projectId")!, c.get("accessSubject"))) ? respond(c, ok({ deleted: true })) : notFound(c),
    )
    .get("/:projectId/access", async (c) => {
      const access = await aiProjects.listAccess(c.req.param("projectId")!, c.get("accessSubject"));
      return access ? respond(c, ok({ access })) : notFound(c);
    })
    .post("/:projectId/access", v("json", ProjectAccessSchema), async (c) => {
      const access = await aiProjects.grantAccess(c.req.param("projectId")!, c.get("accessSubject"), c.req.valid("json"));
      return access ? respond(c, ok({ access }), 201) : notFound(c);
    })
    .patch("/:projectId/access/:accessId", v("json", ProjectAccessUpdateSchema), async (c) =>
      (await aiProjects.updateAccess(
        c.req.param("projectId")!,
        c.req.param("accessId")!,
        c.get("accessSubject"),
        c.req.valid("json").permission,
      ))
        ? respond(c, ok({ updated: true }))
        : notFound(c, "Access entry"),
    )
    .delete("/:projectId/access/:accessId", async (c) =>
      (await aiProjects.revokeAccess(c.req.param("projectId")!, c.req.param("accessId")!, c.get("accessSubject")))
        ? respond(c, ok({ deleted: true }))
        : notFound(c, "Access entry"),
    )
    .get("/:projectId/knowledge", v("query", KnowledgeQuerySchema), async (c) => {
      const project = await aiProjects.get(c.req.param("projectId")!, c.get("accessSubject"));
      if (!project) return notFound(c);
      return respond(c, ok({ knowledge: await aiProjects.listKnowledge(project.id, c.get("accessSubject"), c.req.valid("query").q) }));
    })
    .post("/:projectId/knowledge", v("json", KnowledgeSchema), async (c) => {
      const knowledge = await aiProjects.createKnowledge(c.req.param("projectId")!, c.get("accessSubject"), c.req.valid("json"));
      return knowledge ? respond(c, ok({ knowledge }), 201) : notFound(c);
    })
    .patch("/:projectId/knowledge/:knowledgeId", v("json", UpdateKnowledgeSchema), async (c) => {
      const knowledge = await aiProjects.updateKnowledge(
        c.req.param("projectId")!,
        c.req.param("knowledgeId")!,
        c.get("accessSubject"),
        c.req.valid("json"),
      );
      return knowledge ? respond(c, ok({ knowledge })) : notFound(c, "Knowledge entry");
    })
    .delete("/:projectId/knowledge/:knowledgeId", async (c) =>
      (await aiProjects.deleteKnowledge(c.req.param("projectId")!, c.req.param("knowledgeId")!, c.get("accessSubject")))
        ? respond(c, ok({ deleted: true }))
        : notFound(c, "Knowledge entry"),
    )
    .get("/:projectId/files", async (c) => {
      const project = await aiProjects.get(c.req.param("projectId")!, c.get("accessSubject"));
      if (!project) return notFound(c);
      return respond(c, ok({ files: await aiProjects.listFiles(project.id, c.get("accessSubject")) }));
    })
    .post("/:projectId/files", v("json", ProjectFileSchema), async (c) => {
      const body = c.req.valid("json");
      try {
        const file = await aiProjects.writeFile(c.req.param("projectId")!, c.get("accessSubject"), {
          path: body.path,
          mediaType: body.mediaType,
          bytes: decodeAiFileContent(body.content, body.encoding),
        });
        return file ? respond(c, ok({ file }), 201) : notFound(c);
      } catch (error) {
        return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Invalid project file.")));
      }
    })
    .get("/:projectId/files/:fileId", async (c) => {
      const file = await aiProjects.readFile(c.req.param("projectId")!, c.req.param("fileId")!, c.get("accessSubject"));
      if (!file) return notFound(c, "Project file");
      return respond(
        c,
        ok({ file: { ...file, bytes: undefined }, content: Buffer.from(file.bytes).toString("base64"), encoding: "base64" }),
      );
    })
    .delete("/:projectId/files/:fileId", async (c) =>
      (await aiProjects.deleteFile(c.req.param("projectId")!, c.req.param("fileId")!, c.get("accessSubject")))
        ? respond(c, ok({ deleted: true }))
        : notFound(c, "Project file"),
    )
    .get("/:projectId/references", async (c) => {
      const project = await aiProjects.get(c.req.param("projectId")!, c.get("accessSubject"));
      if (!project) return notFound(c);
      return respond(c, ok({ references: await aiProjects.listReferences(project.id, c.get("accessSubject")) }));
    })
    .post("/:projectId/references", v("json", ReferenceSchema), async (c) => {
      const reference = await aiProjects.createReference(c.req.param("projectId")!, c.get("accessSubject"), c.req.valid("json"));
      return reference ? respond(c, ok({ reference }), 201) : notFound(c);
    })
    .delete("/:projectId/references/:referenceId", async (c) =>
      (await aiProjects.deleteReference(c.req.param("projectId")!, c.req.param("referenceId")!, c.get("accessSubject")))
        ? respond(c, ok({ deleted: true }))
        : notFound(c, "Project reference"),
    );

export type AiProjectsRoutes = ReturnType<typeof createAiProjectsRoutes>;
