import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, jsonResponse, respond, v, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { BaseSchema } from "../contracts";
import { gridsService } from "../service";

const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
});

const TemplateListSchema = z.array(TemplateSummarySchema);

const InstantiateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  withSampleData: z.boolean().optional(),
});

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Grids:Templates"],
      summary: "List built-in base templates",
      responses: { 200: jsonResponse(TemplateListSchema, "Templates") },
    }),
    (c) => c.json(gridsService.template.list()),
  )

  .post(
    "/:templateId",
    describeRoute({
      tags: ["Grids:Templates"],
      summary: "Create a base from a built-in template",
      responses: {
        201: jsonResponse(BaseSchema, "Created base"),
        400: jsonResponse(ErrorResponseSchema, "Invalid template"),
        404: jsonResponse(ErrorResponseSchema, "Template not found"),
      },
    }),
    v("json", InstantiateTemplateSchema),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(
        c,
        () =>
          gridsService.template.instantiate(
            c.req.param("templateId")!,
            { name: body.name, withSampleData: body.withSampleData },
            user.id,
          ),
        201,
      );
    },
  );

export default app;
