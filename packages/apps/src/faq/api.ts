import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok, type Result } from "@valentinkolb/cloud/lib/server";
import { faqService } from "./service";
import {
  FaqEntrySchema,
  CreateFaqSchema,
  UpdateFaqSchema,
  ReorderFaqSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
} from "@/faq/contracts";

const withMessage = async (operation: Promise<Result<unknown>>, message: string) => {
  const result = await operation;
  if (!result.ok) return result;
  return ok({ message });
};

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  // List all FAQs
  .get(
    "/",
    describeRoute({
      tags: ["FAQ"],
      summary: "List all FAQ entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ entries: z.array(FaqEntrySchema) }), "All FAQ entries"),
      },
    }),
    async (c) => {
      const entries = await faqService.entry.list();
      return respond(c, ok({ entries: entries.items }));
    },
  )

  // Create FAQ
  .post(
    "/",
    describeRoute({
      tags: ["FAQ"],
      summary: "Create FAQ entry",
      ...requiresAdmin,
      responses: {
        201: jsonResponse(FaqEntrySchema, "Created FAQ entry"),
        400: jsonResponse(ErrorResponseSchema, "Validation error"),
      },
    }),
    v("json", CreateFaqSchema),
    async (c) => {
      const input = c.req.valid("json");
      return respond(c, faqService.entry.create({ data: input }), 201);
    },
  )

  // Update FAQ
  .patch(
    "/:id",
    describeRoute({
      tags: ["FAQ"],
      summary: "Update FAQ entry",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(FaqEntrySchema, "Updated FAQ entry"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("param", z.object({ id: z.uuid() })),
    v("json", UpdateFaqSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      return respond(c, faqService.entry.update({ id, data: input }));
    },
  )

  // Delete FAQ
  .delete(
    "/:id",
    describeRoute({
      tags: ["FAQ"],
      summary: "Delete FAQ entry",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "FAQ deleted"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("param", z.object({ id: z.uuid() })),
    async (c) => {
      const { id } = c.req.valid("param");
      return respond(c, withMessage(faqService.entry.remove({ id }), "FAQ deleted"));
    },
  )

  // Reorder FAQs
  .put(
    "/reorder",
    describeRoute({
      tags: ["FAQ"],
      summary: "Reorder FAQ entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "FAQs reordered"),
      },
    }),
    v("json", ReorderFaqSchema),
    async (c) => {
      const { ids } = c.req.valid("json");
      return respond(c, withMessage(faqService.entry.reorder({ ids }), "FAQs reordered"));
    },
  );

export default app;
export type ApiType = typeof app;
