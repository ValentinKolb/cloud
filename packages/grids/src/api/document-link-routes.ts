import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  CreateDocumentLinkResponseSchema,
  CreateDocumentLinkSchema,
  DocumentLinkListResponseSchema,
  DocumentLinkSchema,
} from "../contracts";
import { gridsService } from "../service";
import { auditRequestContext, gateRun, uuidParam } from "./documents-api-shared";
import { currentActorUserId } from "./permissions";

export const createDocumentLinkRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List expiring public links for a generated document",
        responses: {
          200: jsonResponse(DocumentLinkListResponseSchema, "Document links"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json({ items: await gridsService.document.listDocumentLinksForRun(run.id) });
      },
    )

    .post(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create an expiring public link for a generated document",
        responses: {
          201: jsonResponse(CreateDocumentLinkResponseSchema, "Created document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDocumentLinkSchema),
      async (c) => {
        const runId = uuidParam(c, "runId");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const created = await gridsService.document.createDocumentLink({
          run,
          input: c.req.valid("json"),
          actorId: currentActorUserId(c),
          ...auditRequestContext(c),
        });
        if (!created.ok) return c.json({ message: created.error.message }, created.error.status);
        return c.json({ link: created.data.link, url: await gridsService.document.publicDocumentLinkUrl(created.data.token) }, 201);
      },
    )

    .post(
      "/links/:linkId/revoke",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Revoke an expiring public document link",
        responses: {
          200: jsonResponse(DocumentLinkSchema, "Revoked document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const linkId = uuidParam(c, "linkId");
        if (!linkId) return c.json({ message: "Document link not found" }, 404);
        const link = await gridsService.document.getDocumentLink(linkId);
        if (!link) return c.json({ message: "Document link not found" }, 404);
        const run = await gridsService.document.getRun(link.documentRunId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));

        const userId = currentActorUserId(c);
        const canRevoke = link.createdBy === userId || gridsService.permission.hasAtLeast(gate.data, "write");
        if (!canRevoke) return c.json({ message: "Only the creator or a document editor can revoke this link." }, 403);

        const revoked = await gridsService.document.revokeDocumentLink({
          linkId: link.id,
          actorId: userId,
          ...auditRequestContext(c),
        });
        if (!revoked.ok) return c.json({ message: revoked.error.message }, revoked.error.status);
        return c.json(revoked.data);
      },
    );
