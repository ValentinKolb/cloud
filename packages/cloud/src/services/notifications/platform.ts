import { sql } from "bun";
import type { output, ZodType } from "zod";
import type {
  BoundNotificationDefinition,
  NotificationChannelId,
  NotificationPresentation,
  NotificationRecipientKind,
  NotificationSendInput,
} from "../../contracts/notification-types";
import { encryptSecret } from "../secrets";
import { ensureNotificationDefinition } from "./catalog";
import { getNotificationChannel, type ResolvedNotificationRecipient } from "./channels";
import { processNotificationDelivery } from "./dispatcher";
import { enqueueNotificationDeliveries, enqueueNotificationDelivery } from "./runtime";

export type TypedNotificationDeliveryStatus = "deferred" | "pending" | "sending" | "delivered" | "suppressed" | "failed";

export type TypedNotificationSendResult = {
  id: string;
  created: boolean;
  status: "queued" | "delivered" | "suppressed" | "error";
  deliveries: Array<{
    id: string;
    channel: string;
    required: boolean;
    status: TypedNotificationDeliveryStatus;
    errorCode: string | null;
  }>;
};

type PreparedDelivery = {
  channel: string;
  endpointId: string | null;
  destinationKey: string;
  destinationLabel: string;
  payloadEncrypted: string;
  required: boolean;
  routePriority: number | null;
  status: "deferred" | "pending" | "suppressed";
  errorCode: string | null;
  errorMessage: string | null;
};

type DeliveryListRow = {
  id: string;
  channel: string;
  required: boolean;
  status: TypedNotificationDeliveryStatus;
  error_code: string | null;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const validatePresentation = (presentation: NotificationPresentation): NotificationPresentation => {
  const title = presentation.title.trim();
  const body = presentation.body?.trim();
  if (!title) throw new Error("Notification title is required");
  if (title.length > 200) throw new Error("Notification title must not exceed 200 characters");
  if (body && body.length > 4_000) throw new Error("Notification body must not exceed 4000 characters");
  if (presentation.targetHref && (!presentation.targetHref.startsWith("/") || presentation.targetHref.startsWith("//"))) {
    throw new Error("Notification targetHref must be a same-origin absolute path");
  }
  return { title, ...(body ? { body } : {}), ...(presentation.targetHref ? { targetHref: presentation.targetHref } : {}) };
};

const resolveRecipient = async (
  recipient: { userId: string } | { email: string },
): Promise<{
  recipient: ResolvedNotificationRecipient;
  recipientKey: string;
}> => {
  if ("userId" in recipient) {
    const rows = await sql<{ id: string; mail: string | null }[]>`
      SELECT id, btrim(mail) AS mail FROM auth.users WHERE id = ${recipient.userId}::uuid LIMIT 1
    `;
    const user = rows[0];
    if (!user) throw new Error("Notification recipient user was not found");
    return {
      recipient: { userId: user.id, email: user.mail?.trim().toLowerCase() || null },
      recipientKey: `user:${user.id}`,
    };
  }

  const email = recipient.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Notification recipient email is invalid");
  return { recipient: { userId: null, email }, recipientKey: `email:${email}` };
};

const preferredChannels = async (
  definitionId: string,
  recipient: ResolvedNotificationRecipient,
  recommended: readonly NotificationChannelId[],
): Promise<string[]> => {
  if (!recipient.userId) return [];
  const rows = await sql<{ channels: string[] }[]>`
    SELECT channels FROM notifications.preferences
    WHERE user_id = ${recipient.userId}::uuid AND definition_id = ${definitionId}
    LIMIT 1
  `;
  return rows[0] ? unique(rows[0].channels) : unique(recommended);
};

const prepareChannel = async (input: {
  channel: string;
  recipient: ResolvedNotificationRecipient;
  presentation: NotificationPresentation;
  emailPresentation?: { subject: string; content?: string; rawHtml?: string };
  required: boolean;
  routePriority: number | null;
}): Promise<PreparedDelivery[]> => {
  const driver = getNotificationChannel(input.channel);
  if (!driver) {
    return [
      {
        channel: input.channel,
        endpointId: null,
        destinationKey: "channel-unavailable",
        destinationLabel: input.channel,
        payloadEncrypted: await encryptSecret(input.presentation),
        required: input.required,
        routePriority: input.routePriority,
        status: "suppressed",
        errorCode: "channel_unavailable",
        errorMessage: `Notification channel "${input.channel}" is unavailable.`,
      },
    ];
  }

  const destinations = await driver.resolveDestinations(input.recipient);
  if (destinations.length === 0) {
    return [
      {
        channel: input.channel,
        endpointId: null,
        destinationKey: "no-endpoint",
        destinationLabel: input.channel,
        payloadEncrypted: await encryptSecret(input.presentation),
        required: input.required,
        routePriority: input.routePriority,
        status: "suppressed",
        errorCode: "no_endpoint",
        errorMessage: `No configured ${input.channel} destination is available.`,
      },
    ];
  }

  return Promise.all(
    destinations.map(async (destination) => ({
      channel: input.channel,
      endpointId: destination.endpointId ?? null,
      destinationKey: destination.key,
      destinationLabel: destination.label,
      payloadEncrypted: await encryptSecret(
        driver.createPayload({ presentation: input.presentation, email: input.emailPresentation, destination }),
      ),
      required: input.required,
      routePriority: input.routePriority,
      status: "deferred" as const,
      errorCode: null,
      errorMessage: null,
    })),
  );
};

const listDeliveries = async (eventId: string): Promise<TypedNotificationSendResult["deliveries"]> => {
  const rows = await sql<DeliveryListRow[]>`
    SELECT id, channel, required, status, error_code
    FROM notifications.deliveries
    WHERE event_id = ${eventId}::uuid
    ORDER BY required DESC, route_priority NULLS FIRST, created_at, id
  `;
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    required: row.required,
    status: row.status,
    errorCode: row.error_code,
  }));
};

const summarize = (id: string, created: boolean, deliveries: TypedNotificationSendResult["deliveries"]): TypedNotificationSendResult => {
  const requiredFailures = deliveries.some(
    (delivery) => delivery.required && (delivery.status === "failed" || delivery.status === "suppressed" || delivery.errorCode !== null),
  );
  const delivered = deliveries.some((delivery) => delivery.status === "delivered");
  const queued = deliveries.some((delivery) => delivery.status === "pending" || delivery.status === "sending");
  return {
    id,
    created,
    status: requiredFailures ? "error" : delivered ? "delivered" : queued ? "queued" : "suppressed",
    deliveries,
  };
};

export const sendTypedNotification = async <
  AppId extends string,
  Key extends string,
  R extends NotificationRecipientKind,
  S extends ZodType,
>(
  definition: BoundNotificationDefinition<AppId, Key, R, S>,
  input: NotificationSendInput<BoundNotificationDefinition<AppId, Key, R, S>>,
): Promise<TypedNotificationSendResult> => {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 300) throw new Error("Notification idempotencyKey must contain 1 to 300 characters");

  const data: output<S> = definition.data.parse(input.data);
  const presentation = validatePresentation(await definition.render(data));
  const emailPresentation = definition.email ? await definition.email(data) : undefined;
  const resolved = await resolveRecipient(input.recipient);
  await ensureNotificationDefinition(definition);

  const requiredChannels = unique([...(definition.delivery?.required ?? [])]);
  const requiredChannelSet = new Set<string>(requiredChannels);
  const preferred = (await preferredChannels(definition.id, resolved.recipient, definition.delivery?.recommended ?? [])).filter(
    (channel) => !requiredChannelSet.has(channel),
  );

  const requiredPlans = (
    await Promise.all(
      requiredChannels.map((channel) =>
        prepareChannel({
          channel,
          recipient: resolved.recipient,
          presentation,
          emailPresentation,
          required: true,
          routePriority: null,
        }),
      ),
    )
  ).flat();
  const preferredPlans = (
    await Promise.all(
      preferred.map((channel, routePriority) =>
        prepareChannel({
          channel,
          recipient: resolved.recipient,
          presentation,
          emailPresentation,
          required: false,
          routePriority,
        }),
      ),
    )
  ).flat();

  const firstPreferredPriority = preferredPlans.find((delivery) => delivery.status !== "suppressed")?.routePriority;
  const plans = [
    ...requiredPlans.map((delivery) => ({ ...delivery, status: delivery.status === "deferred" ? ("pending" as const) : delivery.status })),
    ...preferredPlans.map((delivery) => ({
      ...delivery,
      status: delivery.status === "deferred" && delivery.routePriority === firstPreferredPriority ? ("pending" as const) : delivery.status,
    })),
  ];

  const inserted = await sql.begin(async (tx) => {
    const eventRows = await tx<{ id: string }[]>`
      INSERT INTO notifications.events (
        definition_id, recipient_user_id, recipient_email, recipient_key,
        idempotency_key, title, target_href, sent_by
      ) VALUES (
        ${definition.id}, ${resolved.recipient.userId}, ${resolved.recipient.userId ? null : resolved.recipient.email},
        ${resolved.recipientKey}, ${idempotencyKey}, ${presentation.title}, ${presentation.targetHref ?? null}, ${input.sentBy ?? null}
      )
      ON CONFLICT (definition_id, recipient_key, idempotency_key) DO NOTHING
      RETURNING id
    `;
    const eventId = eventRows[0]?.id;
    if (!eventId) {
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM notifications.events
        WHERE definition_id = ${definition.id} AND recipient_key = ${resolved.recipientKey}
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (!existing[0]) throw new Error("Notification idempotency lookup failed");
      return { id: existing[0].id, created: false, pendingIds: [] as string[], requiredIds: [] as string[] };
    }

    const pendingIds: string[] = [];
    const requiredIds: string[] = [];
    for (const delivery of plans) {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO notifications.deliveries (
          event_id, channel, endpoint_id, destination_key, destination_label,
          payload_encrypted, required, route_priority, status, next_attempt_at,
          error_code, error_message
        ) VALUES (
          ${eventId}::uuid, ${delivery.channel}, ${delivery.endpointId}::uuid, ${delivery.destinationKey},
          ${delivery.destinationLabel}, ${delivery.payloadEncrypted}, ${delivery.required}, ${delivery.routePriority},
          ${delivery.status}, ${delivery.status === "pending" ? new Date() : null}, ${delivery.errorCode}, ${delivery.errorMessage}
        )
        RETURNING id
      `;
      const deliveryId = rows[0]!.id;
      if (delivery.status === "pending") {
        if (delivery.required) requiredIds.push(deliveryId);
        else pendingIds.push(deliveryId);
      }
    }
    return { id: eventId, created: true, pendingIds, requiredIds };
  });

  if (inserted.created) {
    for (const deliveryId of inserted.requiredIds) {
      const result = await processNotificationDelivery(deliveryId);
      if (result.status === "retry") await enqueueNotificationDelivery(deliveryId, result.retryAfterMs);
      if (result.activatedIds?.length) await enqueueNotificationDeliveries(result.activatedIds);
    }
    await enqueueNotificationDeliveries(inserted.pendingIds);
  }

  return summarize(inserted.id, inserted.created, await listDeliveries(inserted.id));
};
