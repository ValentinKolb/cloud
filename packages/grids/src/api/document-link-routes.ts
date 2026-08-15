import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { CreateDocumentLinkSchema } from "../contracts";
import { gridsService } from "../service";
import {
  auditRequestContext,
  gateRun,
  PublicCreateDocumentLinkResponseSchema,
  PublicDocumentLinkListResponseSchema,
  PublicDocumentLinkSchema,
  projectDocumentLinks,
} from "./documents-api-shared";
import { currentActorUserId } from "./permissions";
import { resolvePublicIdParam } from "./route-params";

export const createDocumentLinkRoutes = () =>
  new Hono<AuthContext>()
    .get(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "List expiring public links for a generated document",
        responses: {
          200: jsonResponse(PublicDocumentLinkListResponseSchema, "Document links"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const runId = await resolvePublicIdParam(c, "runId", "documentRun");
        if (!runId) return c.json({ message: "Document run not found" }, 404);
        const run = await gridsService.document.getRun(runId);
        if (!run) return c.json({ message: "Document run not found" }, 404);
        const gate = await gateRun(c, run, "write");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json({ items: await projectDocumentLinks(await gridsService.document.listDocumentLinksForRun(run.id)) });
      },
    )

    .post(
      "/runs/:runId/links",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Create an expiring public link for a generated document",
        responses: {
          201: jsonResponse(PublicCreateDocumentLinkResponseSchema, "Created document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateDocumentLinkSchema),
      async (c) => {
        const runId = await resolvePublicIdParam(c, "runId", "documentRun");
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
        return c.json(
          {
            link: (await projectDocumentLinks([created.data.link]))[0]!,
            url: await gridsService.document.publicDocumentLinkUrl(created.data.token),
          },
          201,
        );
      },
    )

    .post(
      "/links/:linkId/revoke",
      describeRoute({
        tags: ["Grids:Document"],
        summary: "Revoke an expiring public document link",
        responses: {
          200: jsonResponse(PublicDocumentLinkSchema, "Revoked document link"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      async (c) => {
        const linkId = await resolvePublicIdParam(c, "linkId", "documentLink");
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
        return c.json((await projectDocumentLinks([revoked.data]))[0]!);
      },
    );
