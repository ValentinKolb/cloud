import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import {
  AutomationListSchema,
  AutomationRunListSchema,
  AutomationRunSchema,
  AutomationSchema,
  CreateAutomationSchema,
  RunAutomationSchema,
  UpdateAutomationSchema,
  type Automation,
} from "../contracts";
import { gateAt } from "./permissions";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "List automations for a base",
      responses: {
        200: jsonResponse(AutomationListSchema, "Automations"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.automation.listForBase(baseId));
    },
  )

  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "Create an automation",
      responses: {
        201: jsonResponse(AutomationSchema, "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateAutomationSchema),
    async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.automation.create(baseId, c.req.valid("json"), user.id);
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      await gridsService.automationRuntime.sync(result.data);
      return c.json(result.data, 201);
    },
  )

  .get(
    "/:automationId",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "Get an automation",
      responses: {
        200: jsonResponse(AutomationSchema, "Automation"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const automationId = c.req.param("automationId")!;
      const automation = (await gridsService.automation.get(automationId)) as Automation | null;
      if (!automation) return c.json({ message: "Automation not found" }, 404);
      const gate = await gateAt(c, { baseId: automation.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(automation);
    },
  )

  .patch(
    "/:automationId",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "Update an automation",
      responses: {
        200: jsonResponse(AutomationSchema, "Updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", UpdateAutomationSchema),
    async (c) => {
      const automationId = c.req.param("automationId")!;
      const existing = (await gridsService.automation.get(automationId)) as Automation | null;
      if (!existing) return c.json({ message: "Automation not found" }, 404);
      const gate = await gateAt(c, { baseId: existing.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.automation.update(automationId, c.req.valid("json"), user.id);
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      await gridsService.automationRuntime.sync(result.data);
      return c.json(result.data);
    },
  )

  .delete(
    "/:automationId",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "Delete an automation",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const automationId = c.req.param("automationId")!;
      const existing = (await gridsService.automation.get(automationId)) as Automation | null;
      if (!existing) return c.json({ message: "Automation not found" }, 404);
      const gate = await gateAt(c, { baseId: existing.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.automation.remove(automationId, user.id);
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      await gridsService.automationRuntime.delete(automationId);
      return c.body(null, 204);
    },
  )

  .post(
    "/:automationId/run",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "Run an automation manually",
      responses: {
        200: jsonResponse(AutomationRunSchema, "Run"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", RunAutomationSchema),
    async (c) => {
      const automationId = c.req.param("automationId")!;
      const automation = (await gridsService.automation.get(automationId)) as Automation | null;
      if (!automation) return c.json({ message: "Automation not found" }, 404);
      const gate = await gateAt(c, { baseId: automation.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const body = c.req.valid("json");
      return respond(c, () =>
        gridsService.automation.execute({
          automationId,
          triggerKind: "manual",
          reason: body.reason ?? "manual",
          actorId: user.id,
          input: body.input ?? null,
          subject: body.subject ?? { type: "base" },
        }),
      );
    },
  )

  .get(
    "/:automationId/runs",
    describeRoute({
      tags: ["Grids:Automation"],
      summary: "List automation runs",
      responses: {
        200: jsonResponse(AutomationRunListSchema, "Runs"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const automationId = c.req.param("automationId")!;
      const automation = (await gridsService.automation.get(automationId)) as Automation | null;
      if (!automation) return c.json({ message: "Automation not found" }, 404);
      const gate = await gateAt(c, { baseId: automation.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const parsedLimit = z.coerce.number().int().min(1).max(200).safeParse(c.req.query("limit"));
      const limit = parsedLimit.success ? parsedLimit.data : 50;
      return c.json({
        items: await gridsService.automation.listRuns(automationId, limit, {
          redactErrors: gate.data !== "admin",
        }),
      });
    },
  );

export default app;
