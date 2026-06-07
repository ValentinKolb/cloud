import { notifications } from "@valentinkolb/cloud/services";
import { err, fail, ok, paginate, tryCatch, type PageParams, type Paginated } from "@valentinkolb/stdlib";

type NotificationItem = Awaited<ReturnType<typeof notifications.list>>["notifications"][number];

/**
 * Translates notification mutation errors into stable API error variants.
 */
const mapNotificationMutationError = (message: string) => {
  if (message === "Notification not found") return err.notFound("Notification");
  return err.badInput(message);
};

/**
 * Translates send-to-user failures into domain-specific API errors.
 */
const mapSendToUserError = (message: string) => {
  if (message === "User not found") return err.notFound("User");
  return err.badInput(message);
};

export const notificationsService = {
  notification: {
    list: async (config: {
      pagination?: PageParams;
      access: { sentBy: string; isAdmin: boolean; search?: string };
    }): Promise<Paginated<NotificationItem>> => {
      const { page, perPage, offset } = paginate(config.pagination);
      const result = await notifications.list(
        { page, perPage, offset },
        {
          sentBy: config.access.sentBy,
          isAdmin: config.access.isAdmin,
          search: config.access.search,
        },
      );
      return {
        items: result.notifications,
        page,
        perPage,
        total: result.total,
        hasNext: page * perPage < result.total,
      };
    },
    get: async (config: { id: string }) => notifications.getById(config.id),
    sendToUser: async (config: { userId: string; subject: string; content?: string; rawHtml?: string; sentBy: string }) => {
      const result = await notifications.sendToUser(config);
      if (!result.ok) return fail(mapSendToUserError(result.error));
      return ok({ id: result.id });
    },
    resend: async (config: { id: string }) => {
      const result = await notifications.resend(config.id);
      if (!result.ok) return fail(mapNotificationMutationError(result.error));
      return ok();
    },
    update: async (config: {
      id: string;
      data: { subject?: string; content?: string; recipient?: string };
      access: { isAdmin: boolean };
    }) => {
      const result = await notifications.update(config.id, config.data, {
        isAdmin: config.access.isAdmin,
      });
      if (!result.ok) return fail(mapNotificationMutationError(result.error));
      return ok();
    },
  },
  system: {
    pendingCount: async () => notifications.getPendingSystemCount(),
    sendAllPending: async () =>
      tryCatch(
        () => notifications.sendAllPendingSystem(),
        (error) => err.internal(error instanceof Error ? error.message : String(error)),
      ),
  },
};

export type NotificationsService = typeof notificationsService;
