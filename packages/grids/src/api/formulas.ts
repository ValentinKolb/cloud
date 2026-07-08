import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { gridsService } from "../service";
import { checkFormula } from "../service/formula-preview";
import { gateAt } from "./permissions";

const FormulaCheckBodySchema = z.object({
  expression: z.string().max(10_000),
  currentFieldId: z.string().uuid().nullable().optional(),
});

const FormulaPreviewResponseSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(z.object({ severity: z.enum(["error", "info"]), message: z.string() })),
  fields: z.array(
    z.object({
      id: z.string().uuid(),
      shortId: z.string(),
      name: z.string(),
      type: z.string(),
    }),
  ),
  rows: z.array(
    z.object({
      recordId: z.string().uuid(),
      values: z.record(z.string(), z.unknown()),
      result: z.unknown(),
    }),
  ),
});

const app = new Hono<AuthContext>().use(auth.requireRole("authenticated")).post(
  "/by-table/:tableId/check",
  describeRoute({
    tags: ["Grids:Formula"],
    summary: "Validate a formula and preview latest records",
    responses: {
      200: jsonResponse(FormulaPreviewResponseSchema, "Formula diagnostics and preview rows"),
      403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      404: jsonResponse(ErrorResponseSchema, "Table not found"),
    },
  }),
  v("json", FormulaCheckBodySchema),
  async (c) => {
    const tableId = c.req.param("tableId")!;
    const table = await gridsService.table.get(tableId);
    if (!table) return c.json({ message: "Table not found" }, 404);
    const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
    if (!gate.ok) return respond(c, () => Promise.resolve(gate));
    const body = c.req.valid("json");
    const dateConfig = await getDateConfig(c);
    return respond(c, () =>
      checkFormula({
        tableId,
        expression: body.expression,
        currentFieldId: body.currentFieldId ?? null,
        dateConfig,
      }),
    );
  },
);

export default app;
