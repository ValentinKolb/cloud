import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { auth, jsonResponse, respond, v, type AuthContext } from "@valentinkolb/cloud/server";
import { notebooksService } from "../service";

const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
});

const TemplateListSchema = z.array(TemplateSummarySchema);

const CreatedNotebookSchema = z.object({
  id: z.uuid(),
  shortId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  homepageNoteId: z.uuid().nullable(),
  homepageNoteShortId: z.string().nullable(),
  scriptsEnabled: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const InstantiateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Notebooks:Templates"],
      summary: "List built-in notebook templates",
      responses: { 200: jsonResponse(TemplateListSchema, "Templates") },
    }),
    (c) => c.json(notebooksService.template.list()),
  )

  .post(
    "/:templateId",
    describeRoute({
      tags: ["Notebooks:Templates"],
      summary: "Create a notebook from a built-in template",
      responses: {
        201: jsonResponse(CreatedNotebookSchema, "Created notebook"),
        400: jsonResponse(ErrorResponseSchema, "Invalid template"),
        404: jsonResponse(ErrorResponseSchema, "Template not found"),
      },
    }),
    v("json", InstantiateTemplateSchema),
    async (c) => {
      const user = getUserBackedActor(c);
      if (!user) return c.json({ message: "This endpoint requires a user-backed actor", code: "FORBIDDEN" }, 403);
      const body = c.req.valid("json");
      return respond(
        c,
        () => notebooksService.template.instantiate(c.req.param("templateId")!, { name: body.name }, user.id),
        201,
      );
    },
  );

export default app;
