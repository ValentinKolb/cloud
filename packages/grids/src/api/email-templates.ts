import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { CreateEmailTemplateSchema, EmailTemplateListSchema, EmailTemplateSchema, UpdateEmailTemplateSchema } from "../contracts";
import { gridsService } from "../service";
import { currentActorUserId, gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:EmailTemplates"],
      summary: "List email templates for a base",
      responses: {
        200: jsonResponse(EmailTemplateListSchema, "Email templates"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.emailTemplate.listForBase(baseId));
    },
  )

  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:EmailTemplates"],
      summary: "Create an email template",
      responses: {
        201: jsonResponse(EmailTemplateSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid email template"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateEmailTemplateSchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.emailTemplate.create(baseId, c.req.valid("json"), currentActorUserId(c)), 201);
    },
  )

  .get(
    "/:templateId",
    describeRoute({
      tags: ["Grids:EmailTemplates"],
      summary: "Get an email template",
      responses: {
        200: jsonResponse(EmailTemplateSchema, "Email template"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const template = await gridsService.emailTemplate.get(c.req.param("templateId")!);
      if (!template) return c.json({ message: "Email template not found" }, 404);
      const gate = await gateAt(c, { baseId: template.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(template);
    },
  )

  .patch(
    "/:templateId",
    describeRoute({
      tags: ["Grids:EmailTemplates"],
      summary: "Update an email template",
      responses: {
        200: jsonResponse(EmailTemplateSchema, "Updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid email template"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", UpdateEmailTemplateSchema),
    async (c) => {
      const template = await gridsService.emailTemplate.get(c.req.param("templateId")!);
      if (!template) return c.json({ message: "Email template not found" }, 404);
      const gate = await gateAt(c, { baseId: template.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.emailTemplate.update(template.id, c.req.valid("json"), currentActorUserId(c)));
    },
  )

  .delete(
    "/:templateId",
    describeRoute({
      tags: ["Grids:EmailTemplates"],
      summary: "Delete an email template",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const template = await gridsService.emailTemplate.get(c.req.param("templateId")!);
      if (!template) return c.json({ message: "Email template not found" }, 404);
      const gate = await gateAt(c, { baseId: template.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.emailTemplate.remove(template.id, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
