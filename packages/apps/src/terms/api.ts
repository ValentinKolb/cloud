import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok } from "@valentinkolb/cloud/lib/server";
import { termsService } from "./service";
import { TermsVersionSchema, CreateTermsSchema, ErrorResponseSchema } from "@/terms/contracts";

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  // List all versions
  .get(
    "/",
    describeRoute({
      tags: ["Terms"],
      summary: "List all terms versions",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ versions: z.array(TermsVersionSchema) }), "All terms versions"),
      },
    }),
    async (c) => {
      const versions = await termsService.version.list();
      return respond(c, ok({ versions: versions.items }));
    },
  )

  // Create new version
  .post(
    "/",
    describeRoute({
      tags: ["Terms"],
      summary: "Create new terms version",
      ...requiresAdmin,
      responses: {
        201: jsonResponse(TermsVersionSchema, "Created terms version"),
        400: jsonResponse(ErrorResponseSchema, "Validation error"),
      },
    }),
    v("json", CreateTermsSchema),
    async (c) => {
      const { content } = c.req.valid("json");
      return respond(c, termsService.version.create({ content }), 201);
    },
  )

  // Delete version
  .delete(
    "/:id",
    describeRoute({
      tags: ["Terms"],
      summary: "Delete terms version",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ message: z.string() }), "Version deleted"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("param", z.object({ id: z.uuid() })),
    async (c) => {
      const { id } = c.req.valid("param");
      return respond(c, async () => {
        const result = await termsService.version.remove({ id });
        if (!result.ok) return result;
        return ok({ message: "Version deleted" });
      });
    },
  );

export default app;
export type ApiType = typeof app;
