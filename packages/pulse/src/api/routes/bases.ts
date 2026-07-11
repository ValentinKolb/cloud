import { AccessEntrySchema } from "@valentinkolb/cloud/contracts";
import { jsonResponse, respond, respondMessage, v, type AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { pulseService } from "../../service";
import {
  BaseSchema,
  CreateBaseSchema,
  GrantBaseAccessSchema,
  MessageSchema,
  UpdateBaseAccessSchema,
  UpdateBaseSchema,
} from "../schemas";
import { requireUuidParam } from "../shared";

const routes = new Hono<AuthContext>()
  .get(
    "/capabilities",
    describeRoute({
      tags: ["Pulse"],
      summary: "Get Pulse deployment capabilities",
      responses: {
        200: jsonResponse(
          z.object({ timescaleEnabled: z.boolean(), timeBucketAvailable: z.boolean(), continuousAggregatesAvailable: z.boolean() }),
          "Capabilities",
        ),
      },
    }),
    async (c) => respond(c, pulseService.capabilities()),
  )
  .get(
    "/bases",
    describeRoute({
      tags: ["Pulse"],
      summary: "List accessible Pulse bases",
      responses: { 200: jsonResponse(z.array(BaseSchema), "Pulse bases") },
    }),
    async (c) => respond(c, pulseService.base.list(c.get("user"))),
  )
  .post(
    "/bases",
    describeRoute({
      tags: ["Pulse"],
      summary: "Create a Pulse base",
      responses: { 201: jsonResponse(BaseSchema, "Created Pulse base") },
    }),
    v("json", CreateBaseSchema),
    async (c) => respond(c, pulseService.base.create({ ...c.req.valid("json"), user: c.get("user") }), 201),
  )
  .get("/bases/:baseId", async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    return respond(c, pulseService.base.get(baseId.value, c.get("user")));
  })
  .patch(
    "/bases/:baseId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update a Pulse base",
      responses: { 200: jsonResponse(BaseSchema, "Updated Pulse base") },
    }),
    v("json", UpdateBaseSchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.update({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }));
    },
  )
  .delete("/bases/:baseId", async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    return respondMessage(c, pulseService.base.remove({ baseId: baseId.value, user: c.get("user") }), "Pulse base deletion started");
  })
  .post("/bases/:baseId/clear-data", async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    return respondMessage(c, pulseService.base.clearData({ baseId: baseId.value, user: c.get("user") }), "Pulse data clear started");
  })
  .get(
    "/bases/:baseId/access",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse base access entries",
      responses: { 200: jsonResponse(z.array(AccessEntrySchema), "Pulse base access entries") },
    }),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.access.list(baseId.value, c.get("user")));
    },
  )
  .post(
    "/bases/:baseId/access",
    describeRoute({
      tags: ["Pulse"],
      summary: "Grant Pulse base access",
      responses: { 201: jsonResponse(AccessEntrySchema, "Created access entry") },
    }),
    v("json", GrantBaseAccessSchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.base.access.grant({ baseId: baseId.value, user: c.get("user"), ...c.req.valid("json") }), 201);
    },
  )
  .patch(
    "/bases/:baseId/access/:accessId",
    describeRoute({
      tags: ["Pulse"],
      summary: "Update Pulse access level",
      responses: { 200: jsonResponse(MessageSchema, "Access updated") },
    }),
    v("json", UpdateBaseAccessSchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const accessId = requireUuidParam(c.req.param("accessId"), "access ID");
      if (!accessId.ok) return respond(c, accessId.result);
      return respondMessage(
        c,
        pulseService.base.access.update({ baseId: baseId.value, accessId: accessId.value, user: c.get("user"), ...c.req.valid("json") }),
        "Access updated",
      );
    },
  )
  .delete("/bases/:baseId/access/:accessId", async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    const accessId = requireUuidParam(c.req.param("accessId"), "access ID");
    if (!accessId.ok) return respond(c, accessId.result);
    return respondMessage(
      c,
      pulseService.base.access.revoke({ baseId: baseId.value, accessId: accessId.value, user: c.get("user") }),
      "Access revoked",
    );
  });

export default routes;
