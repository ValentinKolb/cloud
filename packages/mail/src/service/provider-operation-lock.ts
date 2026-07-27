import { type Lock, mutex } from "@k2b/sync";
import { withLeaseHeartbeat } from "./lease-heartbeat";

export const MAIL_PROVIDER_OPERATION_LEASE_MS = 5 * 60_000;

export const mailProviderOperationMutex = mutex({
  id: "mail:remote-resource-sync",
  defaultTtl: MAIL_PROVIDER_OPERATION_LEASE_MS,
  retryCount: 0,
});

const lifecycleBarrierMutex = mutex({
  id: "mail:remote-resource-sync",
  defaultTtl: MAIL_PROVIDER_OPERATION_LEASE_MS,
  retryCount: 40,
  retryDelay: 250,
});

const acquireMailboxProviderBarrier = async (remoteResourceIds: readonly string[]): Promise<Lock[] | null> => {
  const locks: Lock[] = [];
  try {
    for (const remoteResourceId of [...new Set(remoteResourceIds)].sort()) {
      const lock = await lifecycleBarrierMutex.acquire(remoteResourceId, MAIL_PROVIDER_OPERATION_LEASE_MS);
      if (!lock) {
        await Promise.all(locks.map((held) => lifecycleBarrierMutex.release(held).catch(() => undefined)));
        return null;
      }
      locks.push(lock);
    }
    return locks;
  } catch (error) {
    await Promise.all(locks.map((held) => lifecycleBarrierMutex.release(held).catch(() => undefined)));
    throw error;
  }
};

const releaseMailboxProviderBarrier = async (locks: readonly Lock[]): Promise<void> => {
  await Promise.all(locks.map((lock) => lifecycleBarrierMutex.release(lock).catch(() => undefined)));
};

type ProviderOperationBarrierResult<T> = { acquired: false } | { acquired: true; value: T };

const mailboxProviderOperationKey = (mailboxId: string): string => `mailbox:${mailboxId}`;

export const withProviderOperationBarrier = async <T>(
  remoteResourceIds: readonly string[],
  work: (assertLeaseActive: () => Promise<void>) => Promise<T>,
): Promise<ProviderOperationBarrierResult<T>> => {
  const locks = await acquireMailboxProviderBarrier(remoteResourceIds);
  if (!locks) return { acquired: false };
  try {
    const value = await withLeaseHeartbeat({
      intervalMs: Math.floor(MAIL_PROVIDER_OPERATION_LEASE_MS / 3),
      heartbeat: async () => {
        const extended = await Promise.all(
          locks.map((lock) => lifecycleBarrierMutex.extend(lock, MAIL_PROVIDER_OPERATION_LEASE_MS).catch(() => false)),
        );
        if (extended.some((active) => !active)) {
          throw Object.assign(new Error("Mailbox provider operation barrier was lost"), {
            code: "MAIL_PROVIDER_OPERATION_LEASE_LOST",
          });
        }
      },
      work,
    });
    return { acquired: true, value };
  } finally {
    await releaseMailboxProviderBarrier(locks);
  }
};

export const withMailboxProviderOperationBarrier = async <T>(
  mailboxId: string,
  remoteResourceIds: readonly string[],
  work: (assertLeaseActive: () => Promise<void>) => Promise<T>,
): Promise<ProviderOperationBarrierResult<T>> =>
  withProviderOperationBarrier([mailboxProviderOperationKey(mailboxId), ...remoteResourceIds], work);
