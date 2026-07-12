import { describe, expect, test } from "bun:test";
import { aiConversationStore, migrateCloudAi } from "@valentinkolb/cloud/ai";
import { registerNotificationDefinitions } from "@valentinkolb/cloud/services/notifications/catalog";
import { sql } from "bun";
import { app } from "./config";
import { createAssistantNotificationService } from "./notifications";

const canRun = async (): Promise<boolean> => {
  if (!process.env.APP_SECRET) return false;
  try {
    const [row] = await sql<{ users: string | null; definitions: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users,
             to_regclass('notifications.definitions')::text AS definitions
    `;
    if (!row?.users || !row.definitions) return false;
    await migrateCloudAi();
    await registerNotificationDefinitions(app.meta.id, app.notifications);
    return true;
  } catch {
    return false;
  }
};

describe("Assistant completion notifications", () => {
  test("recovers each completed direct chat once and skips non-chat resources", async () => {
    if (!(await canRun())) return;

    const suffix = crypto.randomUUID();
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES (${`assistant-notify-${suffix}`}, 'local', 'user', 'Assistant Notify', ${`assistant-notify-${suffix}@example.test`}, 'Assistant', 'Notify')
      RETURNING id
    `;
    const userId = user!.id;
    const conversationIds: string[] = [];
    const service = createAssistantNotificationService(app.notifications);

    try {
      const direct = await aiConversationStore.createConversation({ appId: "assistant", ownerUserId: userId });
      const resource = await aiConversationStore.createConversation({
        appId: "assistant",
        ownerUserId: userId,
        resource: { kind: "resource", appId: "grids", resourceType: "table", resourceId: crypto.randomUUID() },
      });
      const compaction = await aiConversationStore.createConversation({ appId: "assistant", ownerUserId: userId });
      conversationIds.push(direct.id, resource.id, compaction.id);

      const turns = await sql<{ id: string; conversation_id: string }[]>`
        INSERT INTO ai.turns (conversation_id, status, completed_at, run_config)
        VALUES
          (${direct.id}::uuid, 'completed', now(), (${JSON.stringify({ kind: "chat" })}::text)::jsonb),
          (${resource.id}::uuid, 'completed', now(), (${JSON.stringify({ kind: "chat" })}::text)::jsonb),
          (${compaction.id}::uuid, 'completed', now(), (${JSON.stringify({ kind: "compact" })}::text)::jsonb)
        RETURNING id, conversation_id
      `;
      const directTurn = turns.find((turn) => turn.conversation_id === direct.id)!;
      const resourceTurn = turns.find((turn) => turn.conversation_id === resource.id)!;
      const compactionTurn = turns.find((turn) => turn.conversation_id === compaction.id)!;

      const [eligibility] = await sql<{ app_id: string; resource_kind: string; run_kind: string | null; after_definition: boolean }[]>`
        SELECT conversation.app_id,
               conversation.resource_kind,
               turn.run_config->>'kind' AS run_kind,
               turn.completed_at >= definition.first_seen_at AS after_definition
        FROM ai.turns turn
        JOIN ai.conversations conversation ON conversation.id = turn.conversation_id
        JOIN notifications.definitions definition ON definition.id = ${app.notifications.turnCompleted.id}
        WHERE turn.id = ${directTurn.id}::uuid
      `;
      expect(eligibility).toEqual({ app_id: "assistant", resource_kind: "direct", run_kind: "chat", after_definition: true });

      const first = await service.notifyTurnCompleted(directTurn.id);
      // A running Assistant replica may win the same recovery race. The
      // durable event below is the invariant; both paths use the same key.
      expect(first.failed).toBe(0);
      expect(first.scanned).toBe(first.sent);
      expect(first.scanned).toBeLessThanOrEqual(1);
      expect(await service.notifyTurnCompleted(directTurn.id)).toEqual({ scanned: 0, sent: 0, failed: 0 });
      expect(await service.notifyTurnCompleted(resourceTurn.id)).toEqual({ scanned: 0, sent: 0, failed: 0 });
      expect(await service.notifyTurnCompleted(compactionTurn.id)).toEqual({ scanned: 0, sent: 0, failed: 0 });

      const events = await sql<{ id: string; title: string; target_href: string | null; idempotency_key: string }[]>`
        SELECT id, title, target_href, idempotency_key
        FROM notifications.events
        WHERE definition_id = ${app.notifications.turnCompleted.id}
          AND recipient_user_id = ${userId}::uuid
      `;
      expect(events).toEqual([
        {
          id: expect.any(String),
          title: "Assistant response ready",
          target_href: `/app/assistant?conversation=${direct.id}`,
          idempotency_key: `turn:${directTurn.id}`,
        },
      ]);
      const deliveries = await sql<{ channel: string; status: string; error_code: string | null; payload_encrypted: string | null }[]>`
        SELECT delivery.channel, delivery.status, delivery.error_code, delivery.payload_encrypted
        FROM notifications.deliveries delivery
        JOIN notifications.events event ON event.id = delivery.event_id
        WHERE event.definition_id = ${app.notifications.turnCompleted.id}
          AND event.recipient_user_id = ${userId}::uuid
      `;
      expect(deliveries).toEqual([expect.objectContaining({ channel: "browser", status: "suppressed", error_code: "no_endpoint" })]);
      expect(deliveries[0]?.payload_encrypted).toBeNull();
    } finally {
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
