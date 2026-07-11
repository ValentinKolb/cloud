import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateDocumentTemplateSchema,
  DocumentTemplateListSchema,
  DocumentTemplateSchema,
  DocumentTemplateSummaryListSchema,
  RelationLookupResponseSchema,
  UpdateDocumentTemplateSchema,
} from "../contracts";
import { gridsService } from "../service";
import {
  DocumentTemplateSummaryQuerySchema,
  gateEnabledTemplateWrite,
  gateTemplate,
  loadTemplateAndTable,
  RecordLookupQuerySchema,
  uuidParam,
} from "./documents-api-shared";
import { currentActorUserId, gateAt } from "./permissions";

export const createDocumentTemplateRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/templates/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List document templates for a table",
        responses: {
          200: jsonResponse(DocumentTemplateSummaryListSchema, "Document templates"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", DocumentTemplateSummaryQuerySchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const tableGate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
        const templates = await gridsService.document.listTemplatesForTable(tableId);
        const required = c.req.valid("query").min;
        const visible = [];
        for (const template of templates) {
          if (!template.enabled) continue;
          const templateGate = await gateTemplate(c, { template, table }, required);
          if (templateGate.ok) visible.push(gridsService.document.summarizeTemplate(template));
        }
        if (!tableGate.ok && visible.length === 0) return respond(c, () => Promise.resolve(tableGate));
        return c.json(visible);
      },
    )

    .get(
      "/templates/by-table/:tableId/full",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List full document templates for table admins",
        responses: {
          200: jsonResponse(DocumentTemplateListSchema, "Document templates"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(await gridsService.document.listTemplatesForTable(tableId));
      },
    )

    .post(
      "/templates/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create a document template",
        responses: {
          201: jsonResponse(DocumentTemplateSchema, "Created document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDocumentTemplateSchema),
      async (c) => {
        const tableId = uuidParam(c, "tableId");
        if (!tableId) return c.json({ message: "Table not found" }, 404);
        const table = await gridsService.table.get(tableId);
        if (!table) return c.json({ message: "Table not found" }, 404);
        const gate = await gateAt(c, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => gridsService.document.createTemplate(tableId, c.req.valid("json"), currentActorUserId(c)), 201);
      },
    )

    .get(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Get a document template",
        responses: {
          200: jsonResponse(DocumentTemplateSchema, "Document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(loaded.template);
      },
    )

    .patch(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Update a document template",
        responses: {
          200: jsonResponse(DocumentTemplateSchema, "Updated document template"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", UpdateDocumentTemplateSchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return respond(c, () => gridsService.document.updateTemplate(loaded.template.id, c.req.valid("json"), currentActorUserId(c)));
      },
    )

    .delete(
      "/templates/:templateId",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Delete a document template",
        responses: {
          204: { description: "Deleted" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateTemplate(c, loaded, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.document.removeTemplate(loaded.template.id, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .get(
      "/templates/:templateId/records/lookup",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Search records for a document template",
        responses: {
          200: jsonResponse(RelationLookupResponseSchema, "Lookup results"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("query", RecordLookupQuerySchema),
      async (c) => {
        const loaded = await loadTemplateAndTable(c.req.param("templateId")!);
        if (!loaded) return c.json({ message: "Document template not found" }, 404);
        const gate = await gateEnabledTemplateWrite(c, loaded);
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const { q, limit, excludeIds } = c.req.valid("query");
        return c.json(await gridsService.relations.lookup({ targetTableId: loaded.table.id, q, limit, excludeIds }));
      },
    );
