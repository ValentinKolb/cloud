import { sql } from "bun";
import type { AnyBoundNotificationDefinition } from "../../contracts/notification-types";
import { toPgTextArray } from "../postgres";

type NotificationCatalog = Readonly<Record<string, AnyBoundNotificationDefinition>>;

const upsertDefinition = async (definition: AnyBoundNotificationDefinition, db: typeof sql = sql): Promise<void> => {
  const recommended = toPgTextArray([...(definition.delivery?.recommended ?? [])]);
  const required = toPgTextArray([...(definition.delivery?.required ?? [])]);
  await db`
    INSERT INTO notifications.definitions (
      id, app_id, kind, label, description, recipient_kind,
      recommended_channels, required_channels, active, last_seen_at, updated_at
    ) VALUES (
      ${definition.id}, ${definition.appId}, ${definition.key}, ${definition.label},
      ${definition.description}, ${definition.recipient}, ${recommended}::text[],
      ${required}::text[], true, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      app_id = EXCLUDED.app_id,
      kind = EXCLUDED.kind,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      recipient_kind = EXCLUDED.recipient_kind,
      recommended_channels = EXCLUDED.recommended_channels,
      required_channels = EXCLUDED.required_channels,
      active = true,
      last_seen_at = now(),
      updated_at = now()
  `;
};

/** Persist serializable app metadata; schemas and renderers remain code-owned. */
export const registerNotificationDefinitions = async (appId: string, definitions: NotificationCatalog): Promise<void> => {
  const current = Object.values(definitions);
  if (current.some((definition) => definition.appId !== appId)) {
    throw new Error(`Notification catalog for app "${appId}" contains a definition owned by another app`);
  }
  const ids = toPgTextArray(current.map((definition) => definition.id));
  await sql.begin(async (tx) => {
    for (const definition of current) await upsertDefinition(definition, tx);
    await tx`
      UPDATE notifications.definitions
      SET active = false, updated_at = now()
      WHERE app_id = ${appId} AND NOT (id = ANY(${ids}::text[]))
    `;
  });
};

export const ensureNotificationDefinition = upsertDefinition;
