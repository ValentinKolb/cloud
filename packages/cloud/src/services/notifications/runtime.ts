import { type QueueReceived, queue } from "@valentinkolb/sync";
import { logger, trace } from "../logging";
import { processNotificationDelivery, recoverNotificationDeliveries } from "./dispatcher";

type DeliveryMessage = { deliveryId: string };

const log = logger("notifications:delivery");
const deliveryQueue = queue<DeliveryMessage>({
  id: "cloud-notification-deliveries",
  delivery: { defaultLeaseMs: 60_000, maxDeliveries: 20 },
});

export const enqueueNotificationDelivery = async (deliveryId: string, delayMs?: number): Promise<void> => {
  await deliveryQueue.send({ data: { deliveryId }, ...(delayMs ? { delayMs } : {}) });
};

export const enqueueNotificationDeliveries = async (deliveryIds: readonly string[]): Promise<void> => {
  await Promise.all(deliveryIds.map((id) => enqueueNotificationDelivery(id)));
};

const handleDelivery = async (message: QueueReceived<DeliveryMessage>): Promise<void> => {
  try {
    const result = await trace.withSpan(
      {
        name: "Notification delivery",
        source: "notifications:delivery",
        appId: "core",
        category: "job",
        kind: "consumer",
        attributes: { "cloud.notification.delivery_id": message.data.deliveryId },
      },
      () => processNotificationDelivery(message.data.deliveryId),
    );
    if (result.activatedIds?.length) await enqueueNotificationDeliveries(result.activatedIds);
    if (result.status === "retry") {
      await message.nack({ delayMs: result.retryAfterMs, reason: "provider_retry", error: result.error });
      return;
    }
    await message.ack();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Notification worker failed";
    log.error("Delivery worker failed", { deliveryId: message.data.deliveryId, error: messageText });
    await message.nack({ delayMs: 5_000, reason: "worker_error", error: messageText }).catch(() => false);
  }
};

let stopRuntime: (() => Promise<void>) | null = null;

export const startNotificationRuntime = async (input: { concurrency?: number; recoveryIntervalMs?: number } = {}): Promise<void> => {
  if (stopRuntime) return;
  const controller = new AbortController();
  const concurrency = Math.min(Math.max(Math.floor(input.concurrency ?? 4), 1), 16);
  const recoveryIntervalMs = Math.max(input.recoveryIntervalMs ?? 30_000, 5_000);

  const recover = async () => {
    try {
      await enqueueNotificationDeliveries(await recoverNotificationDeliveries());
    } catch (error) {
      log.error("Delivery recovery failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };
  await recover();
  const timer = setInterval(() => void recover(), recoveryIntervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();

  const readers = Array.from({ length: concurrency }, () =>
    (async () => {
      for await (const message of deliveryQueue.stream({ signal: controller.signal })) await handleDelivery(message);
    })().catch((error) => {
      if (!controller.signal.aborted)
        log.error("Delivery reader stopped", { error: error instanceof Error ? error.message : String(error) });
    }),
  );

  stopRuntime = async () => {
    clearInterval(timer);
    controller.abort();
    await Promise.allSettled(readers);
    stopRuntime = null;
  };
};

export const stopNotificationRuntime = async (): Promise<void> => {
  await stopRuntime?.();
};
