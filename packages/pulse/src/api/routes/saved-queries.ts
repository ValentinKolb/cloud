import { jsonResponse, respond, respondMessage, v, type AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { pulseService } from "../../service";
import { CreateSavedQuerySchema, SavedQuerySchema } from "../schemas";
import { requireUuidParam } from "../shared";

const routes = new Hono<AuthContext>()
  .get(
    "/bases/:baseId/saved-queries",
    describeRoute({
      tags: ["Pulse"],
      summary: "List saved Pulse queries",
      responses: { 200: jsonResponse(z.array(SavedQuerySchema), "Saved Pulse queries") },
    }),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.savedQuery.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/saved-queries",
    describeRoute({
      tags: ["Pulse"],
      summary: "Save a Pulse query",
      responses: { 201: jsonResponse(SavedQuerySchema, "Saved Pulse query") },
    }),
    v("json", CreateSavedQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.savedQuery.create({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .delete("/bases/:baseId/saved-queries/:queryId", async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const queryId = requireUuidParam(c.req.param("queryId"), "saved query ID");
    if (!queryId.ok) return respond(c, queryId.result);
    return respondMessage(
      c,
      pulseService.savedQuery.remove({ baseId: baseId.value, queryId: queryId.value, user: c.get("user") }),
      "Query removed",
    );
  });

export default routes;
