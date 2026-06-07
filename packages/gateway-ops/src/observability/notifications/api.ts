import {
  createPagination,
  ErrorResponseSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  parsePagination,
} from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, rateLimit, requiresAdmin, requiresAuth, respond, v } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { notificationsService } from "./service";

const SendNotificationSchema = z.object({
  userId: z.uuid().describe("Target user's database ID"),
  subject: z.string().min(1).describe("Notification subject"),
  content: z.string().optional().describe("Plain text content"),
  rawHtml: z.string().optional().describe("HTML content (takes precedence over content)"),
});

const UpdateNotificationSchema = z.object({
  subject: z.string().min(1).optional().describe("Notification subject"),
  content: z.string().optional().describe("Content (HTML)"),
  recipient: z.email().optional().describe("Recipient email"),
});

const NotificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(["email"]),
  recipient: z.string(),
  subject: z.string(),
  content: z.string(),
  sentAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  sentBy: z.uuid().nullable(),
  sentByName: z.string().nullable(),
  status: z.enum(["sent", "pending", "error"]),
});

const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  pagination: PaginationResponseSchema,
});

/**
 * Normalizes notification date fields for API responses.
 */
const toNotificationDto = (notification: Awaited<ReturnType<typeof notificationsService.notification.list>>["items"][number]) => ({
  ...notification,
  sentAt: notification.sentAt?.toISOString() ?? null,
  createdAt: notification.createdAt.toISOString(),
});

/**
 * Loads a notification and enforces owner/admin visibility checks for subsequent mutation routes.
 */
const requireNotificationAccess = async (
  c: Context<AuthContext>,
  config: {
    id: string;
    user: AuthContext["Variables"]["user"];
  },
) => {
  const notification = await notificationsService.notification.get({
    id: config.id,
  });

  if (!notification) {
    return {
      notification: null,
      error: await respond(c, fail(err.notFound("Notification"))),
    };
  }

  if (!config.user.roles.includes("admin") && notification.sentBy !== config.user.id) {
    return {
      notification: null,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  return { notification };
};

/**
 * Wraps mutation results and returns a standardized message payload for API handlers.
 */
const respondMessage = async (
  c: Context,
  resultPromise: Promise<
    | { ok: true; data: void }
    | {
        ok: false;
        error: {
          code: string;
          message: string;
          status: 400 | 401 | 403 | 404 | 409 | 500;
        };
      }
  >,
  message: string,
) => {
  return respond(c, async () => {
    const result = await resultPromise;
    if (!result.ok) return result;
    return ok({ message });
  });
};

/** Notification routes - available to all authenticated users. */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))
  // List notifications (admins see all, users see own)
  .get(
    "/",
    describeRoute({
      tags: ["Notifications"],
      summary: "List notifications",
      description: "List notifications. Admins see all notifications, regular users see only their own sent notifications.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NotificationListResponseSchema, "List of notifications"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", PaginationQuerySchema.extend({ search: z.string().optional() })),
    async (c) => {
      const user = c.get("user");

      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { items, total } = await notificationsService.notification.list({
        pagination,
        access: {
          isAdmin: user.roles.includes("admin"),
          sentBy: user.id,
          search: query.search,
        },
      });

      return respond(
        c,
        ok({
          notifications: items.map(toNotificationDto),
          pagination: createPagination(pagination, total),
        }),
      );
    },
  )
  // Get single notification
  .get(
    "/:id",
    describeRoute({
      tags: ["Notifications"],
      summary: "Get notification by ID",
      description: "Get a single notification. Admins can access any notification, users can only access their own.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NotificationSchema, "Notification details"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notification not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing notification ID")));
      const notificationCheck = await requireNotificationAccess(c, { id, user });
      if (notificationCheck.error || !notificationCheck.notification) {
        return notificationCheck.error!;
      }

      return respond(c, ok(toNotificationDto(notificationCheck.notification)));
    },
  )
  // Send notification to user (admin only — non-admin users have no
  // legitimate need to send arbitrary HTML email to other users by UUID).
  .post(
    "/send",
    describeRoute({
      tags: ["Notifications"],
      summary: "Send notification to user",
      description: "Send a notification to a user by their database ID. Admin only.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Notification sent"),
        400: jsonResponse(ErrorResponseSchema, "Failed to send notification"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    auth.requireRole("admin"),
    v("json", SendNotificationSchema),
    async (c) => {
      const user = c.get("user");

      const { userId, subject, content, rawHtml } = c.req.valid("json");

      return respond(c, async () => {
        const result = await notificationsService.notification.sendToUser({
          userId,
          subject,
          content,
          rawHtml,
          sentBy: user.id,
        });
        if (!result.ok) return result;
        return ok({ message: "Notification sent" });
      });
    },
  )
  // Resend notification
  .post(
    "/:id/resend",
    describeRoute({
      tags: ["Notifications"],
      summary: "Resend notification",
      description: "Retry sending a failed or pending notification. Admins can resend any, users only their own.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Notification resent"),
        400: jsonResponse(ErrorResponseSchema, "Failed to resend notification"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notification not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing notification ID")));
      const notificationCheck = await requireNotificationAccess(c, { id, user });
      if (notificationCheck.error || !notificationCheck.notification) {
        return notificationCheck.error!;
      }

      return respondMessage(c, notificationsService.notification.resend({ id }), "Notification resent");
    },
  )
  // Get pending system notifications count
  .get(
    "/pending-system/count",
    describeRoute({
      tags: ["Notifications"],
      summary: "Get pending system notifications count",
      description: "Get the count of pending system notifications (those without a sender). Admin only.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ count: z.number() }), "Pending count"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    auth.requireRole("admin"),
    async (c) => {
      const count = await notificationsService.system.pendingCount();
      return respond(c, ok({ count }));
    },
  )
  // Send all pending system notifications
  .post(
    "/pending-system/send-all",
    describeRoute({
      tags: ["Notifications"],
      summary: "Send all pending system notifications",
      description: "Send all pending system notifications (those without a sender, e.g., welcome emails). Admin only.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(
          z.object({
            sent: z.number().describe("Number of successfully sent notifications"),
            failed: z.number().describe("Number of failed notifications"),
            errors: z.array(
              z.object({
                id: z.string(),
                recipient: z.string(),
                error: z.string(),
              }),
            ),
          }),
          "Send result",
        ),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    auth.requireRole("admin"),
    async (c) => {
      return respond(c, notificationsService.system.sendAllPending());
    },
  )
  // Update notification (only pending/error)
  .patch(
    "/:id",
    describeRoute({
      tags: ["Notifications"],
      summary: "Update notification",
      description: "Update a pending or failed notification. Cannot edit sent notifications. Admins can update any, users only their own.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Notification updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update notification"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notification not found"),
      },
    }),
    v("json", UpdateNotificationSchema),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing notification ID")));
      const notificationCheck = await requireNotificationAccess(c, { id, user });
      if (notificationCheck.error || !notificationCheck.notification) {
        return notificationCheck.error!;
      }

      const data = c.req.valid("json");
      return respondMessage(
        c,
        notificationsService.notification.update({
          id,
          data,
          access: { isAdmin: user.roles.includes("admin") },
        }),
        "Notification updated",
      );
    },
  );

export default app;
export type ApiType = typeof app;
