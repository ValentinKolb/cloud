import { sql } from "bun";
import type { AnyBoundNotificationDefinition } from "../../contracts/notification-types";
import { toPgTextArray } from "../postgres";

type NotificationCatalog = Readonly<Record<string, AnyBoundNotificationDefinition>>;

const upsertDefinition = async (definition: AnyBoundNotificationDefinition): Promise<void> => {
  const recommended = toPgTextArray([...(definition.delivery?.recommended ?? [])]);
  const required = toPgTextArray([...(definition.delivery?.required ?? [])]);
  await sql`
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
export const registerNotificationDefinitions = async (definitions: NotificationCatalog): Promise<void> => {
  await Promise.all(Object.values(definitions).map(upsertDefinition));
};

export const ensureNotificationDefinition = upsertDefinition;
