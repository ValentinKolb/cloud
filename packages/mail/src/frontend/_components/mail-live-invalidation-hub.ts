export type MailLiveInvalidation = {
  cursor: string | null;
  conversationIds: ReadonlySet<string> | null;
};

type MailLiveInvalidator = {
  matches: (invalidation: MailLiveInvalidation) => boolean;
  invalidate: (invalidation: MailLiveInvalidation) => Promise<void>;
};

type PendingInvalidation = MailLiveInvalidation & { sequence: number };

export const createMailLiveInvalidationHub = (options: {
  delayMs: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  isBlocked: () => boolean;
  onApplied: (cursor: string | null) => void;
  onFailed: (attempt: number) => void;
}) => {
  const invalidators = new Set<MailLiveInvalidator>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PendingInvalidation | null = null;
  let sequence = 0;
  let running = false;
  let disposed = false;
  let failedAttempts = 0;

  const merge = (current: PendingInvalidation | null, incoming: PendingInvalidation): PendingInvalidation => ({
    sequence: Math.max(current?.sequence ?? 0, incoming.sequence),
    cursor: incoming.sequence >= (current?.sequence ?? 0) ? incoming.cursor : (current?.cursor ?? null),
    conversationIds:
      current?.conversationIds === null || incoming.conversationIds === null
        ? null
        : new Set([...(current?.conversationIds ?? []), ...incoming.conversationIds]),
  });

  const arm = (delayMs = options.delayMs) => {
    if (disposed || running || timer || !pending || options.isBlocked()) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const flush = async () => {
    if (disposed || running || !pending || options.isBlocked()) return;
    running = true;
    const current = pending;
    pending = null;
    const matching = [...invalidators].filter((invalidator) => invalidator.matches(current));
    try {
      await Promise.all(matching.map((invalidator) => invalidator.invalidate(current)));
      if (disposed) return;
      failedAttempts = 0;
      options.onApplied(current.cursor);
    } catch {
      if (disposed) return;
      pending = merge(pending, current);
      failedAttempts += 1;
      options.onFailed(failedAttempts);
      const base = options.retryBaseMs ?? 1_000;
      const maximum = options.retryMaxMs ?? 15_000;
      const exponentialDelay = Math.min(maximum, base * 2 ** Math.min(failedAttempts - 1, 5));
      const retryDelay = Math.max(1, Math.round(exponentialDelay * (0.8 + Math.random() * 0.4)));
      running = false;
      arm(retryDelay);
      return;
    }
    running = false;
    arm();
  };

  return {
    register: (invalidator: MailLiveInvalidator) => {
      if (disposed) return () => undefined;
      invalidators.add(invalidator);
      return () => invalidators.delete(invalidator);
    },
    schedule: (invalidation: Omit<MailLiveInvalidation, "conversationIds"> & { conversationId?: string | null }) => {
      if (disposed) return;
      const next: PendingInvalidation = {
        sequence: ++sequence,
        cursor: invalidation.cursor,
        conversationIds: invalidation.conversationId ? new Set([invalidation.conversationId]) : null,
      };
      pending = merge(pending, next);
      arm();
    },
    resume: arm,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      invalidators.clear();
    },
  };
};
