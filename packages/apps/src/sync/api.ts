import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok } from "@valentinkolb/cloud/lib/server";
import { syncService } from "./service";
import { MessageResponseSchema, ErrorResponseSchema } from "@valentinkolb/cloud/contracts/shared";

/** Admin sync routes — manually trigger IPA sync. */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))
  .post(
    "/",
    describeRoute({
      tags: ["Sync"],
      summary: "Trigger IPA sync",
      description: "Manually trigger a full sync from FreeIPA to the local database. Admin access required.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Sync completed successfully"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "Sync failed"),
      },
    }),
    async (c) => {
      return respond(c, async () => {
        const result = await syncService.ipa.run();
        if (!result.ok) return result;
        return ok({ message: "Sync completed successfully." });
      });
    },
  );

export default app;
export type ApiType = typeof app;
