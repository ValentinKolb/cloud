import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { z } from "zod";
import { defineApp, notification } from "../..";
import { notifications } from ".";
import { registerNotificationChannel } from "./channels";

declare module "../../contracts/notification-types" {
  interface NotificationChannelRegistry {
    test: true;
  }
}

const canUseNotificationDatabase = async (): Promise<boolean> => {
  if (!process.env.APP_SECRET) return false;
  try {
    const rows = await sql<
      Array<{
        users: string | null;
        definitions: string | null;
        events: string | null;
        deliveries: string | null;
      }>
    >`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('notifications.definitions')::text AS definitions,
        to_regclass('notifications.events')::text AS events,
        to_regclass('notifications.deliveries')::text AS deliveries
    `;
    return Boolean(rows[0]?.users && rows[0].definitions && rows[0].events && rows[0].deliveries);
  } catch {
    return false;
  }
};

describe("typed notification delivery integration", () => {
  test("persists encrypted delivery state and deduplicates sends", async () => {
    if (!(await canUseNotificationDatabase())) return;

    const suffix = crypto.randomUUID();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES (
        ${`notification-platform-${suffix}`}, 'local', 'user', 'Notification Platform Test',
        ${`notification-platform-${suffix}@example.test`}, 'Notification', 'Platform'
      )
      RETURNING id
    `;
    const userId = rows[0]!.id;
    const delivered: unknown[] = [];
    const unregister = registerNotificationChannel({
      id: "test",
      resolveDestinations: async () => [{ key: "test-destination", label: "Test device", context: { token: "endpoint-secret" } }],
      createPayload: ({ presentation, destination }) => ({ presentation, destination: destination.context }),
      deliver: async (payload) => {
        delivered.push(payload);
      },
    });

    const app = defineApp({
      id: "notification-platform-test",
      name: "Notification Platform Test",
      icon: "ti ti-bell",
      description: "Notification platform integration fixture.",
      baseUrl: "http://notification-platform-test:3000",
      routes: ["/notification-platform-test"],
      notifications: {
        completed: notification({
          recipient: "user",
          label: "Completed",
          description: "A test operation completed.",
          delivery: { required: ["test"] },
          data: z.object({ resourceId: z.string() }),
          render: ({ resourceId }) => ({ title: "Completed", body: `Resource ${resourceId}`, targetHref: `/resources/${resourceId}` }),
        }),
      },
    });

    try {
      const idempotencyKey = `completion:${suffix}`;
      const first = await notifications.send(app.notifications.completed, {
        recipient: { userId },
        data: { resourceId: "resource-1" },
        idempotencyKey,
      });
      const duplicate = await notifications.send(app.notifications.completed, {
        recipient: { userId },
        data: { resourceId: "resource-1" },
        idempotencyKey,
      });

      expect(first.status).toBe("delivered");
      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(delivered).toHaveLength(1);

      const deliveryRows = await sql<{ payload_encrypted: string; status: string; attempt_count: number }[]>`
        SELECT payload_encrypted, status, attempt_count
        FROM notifications.deliveries
        WHERE event_id = ${first.id}::uuid
      `;
      expect(deliveryRows).toHaveLength(1);
      expect(deliveryRows[0]?.status).toBe("delivered");
      expect(deliveryRows[0]?.attempt_count).toBe(1);
      expect(deliveryRows[0]?.payload_encrypted).not.toContain("resource-1");
      expect(deliveryRows[0]?.payload_encrypted).not.toContain("endpoint-secret");
    } finally {
      unregister();
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
      await sql`DELETE FROM notifications.definitions WHERE id = 'notification-platform-test.completed'`;
    }
  });
});
