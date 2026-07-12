import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { browserNotifications } from "./browser";

const canUseNotificationDatabase = async (): Promise<boolean> => {
  if (!process.env.APP_SECRET) return false;
  try {
    const rows = await sql<Array<{ users: string | null; endpoints: string | null }>>`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('notifications.endpoints')::text AS endpoints
    `;
    return Boolean(rows[0]?.users && rows[0].endpoints);
  } catch {
    return false;
  }
};

describe("browser notification endpoints", () => {
  test("rejects private push endpoints before persistence", async () => {
    await expect(
      browserNotifications.registerEndpoint({
        userId: crypto.randomUUID(),
        subscription: {
          endpoint: "https://127.0.0.1/push",
          expirationTime: null,
          keys: { p256dh: "p".repeat(65), auth: "a".repeat(24) },
        },
        label: "Unsafe device",
      }),
    ).rejects.toThrow("public HTTPS");
  });

  test("encrypts subscriptions and atomically rebinds a browser to the latest user", async () => {
    if (!(await canUseNotificationDatabase())) return;

    const suffix = crypto.randomUUID();
    const users = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES
        (${`browser-notifications-a-${suffix}`}, 'local', 'user', 'Browser A', ${`browser-a-${suffix}@example.test`}, 'Browser', 'A'),
        (${`browser-notifications-b-${suffix}`}, 'local', 'user', 'Browser B', ${`browser-b-${suffix}@example.test`}, 'Browser', 'B')
      RETURNING id
    `;
    const firstUserId = users[0]!.id;
    const secondUserId = users[1]!.id;
    const subscription = {
      endpoint: `https://push.example.test/subscriptions/${suffix}`,
      expirationTime: null,
      keys: {
        p256dh: `p256dh-${suffix}-public-key-material`,
        auth: `auth-${suffix}`,
      },
    };

    try {
      const first = await browserNotifications.registerEndpoint({
        userId: firstUserId,
        subscription,
        label: "First device",
      });
      const stored = await sql<{ user_id: string; secret_encrypted: string; disabled_at: Date | null }[]>`
        SELECT user_id, secret_encrypted, disabled_at
        FROM notifications.endpoints
        WHERE id = ${first.id}::uuid
      `;
      expect(stored[0]?.user_id).toBe(firstUserId);
      expect(stored[0]?.disabled_at).toBeNull();
      expect(stored[0]?.secret_encrypted).not.toContain(subscription.endpoint);
      expect(stored[0]?.secret_encrypted).not.toContain(subscription.keys.auth);

      const second = await browserNotifications.registerEndpoint({
        userId: secondUserId,
        subscription,
        label: "Second device",
      });
      const active = await sql<{ id: string; user_id: string; label: string }[]>`
        SELECT id, user_id, label
        FROM notifications.endpoints
        WHERE channel = 'browser' AND disabled_at IS NULL
          AND endpoint_hash = (SELECT endpoint_hash FROM notifications.endpoints WHERE id = ${second.id}::uuid)
      `;
      expect(active).toEqual([{ id: second.id, user_id: secondUserId, label: "Second device" }]);
      expect(await browserNotifications.disableEndpoint({ userId: firstUserId, subscription })).toBe(false);
      expect(await browserNotifications.disableEndpoint({ userId: secondUserId, subscription })).toBe(true);
    } finally {
      await sql`DELETE FROM auth.users WHERE id IN (${firstUserId}::uuid, ${secondUserId}::uuid)`;
    }
  });
});
