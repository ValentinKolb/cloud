export type MailLiveRefreshResult = "applied" | "failed" | "stale";

type MailLiveRefreshCoordinator = {
  schedule: (cursor?: string | null) => void;
  resume: () => void;
  dispose: () => void;
};

export const createMailLiveRefreshCoordinator = (options: {
  delayMs: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  isBlocked: () => boolean;
  refresh: () => Promise<MailLiveRefreshResult>;
  onApplied: (cursor: string | null) => void;
  onFailed: (attempt: number) => void;
}): MailLiveRefreshCoordinator => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let pendingCursor: string | null = null;
  let disposed = false;
  let failedAttempts = 0;

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
    pending = false;
    const cursor = pendingCursor;
    pendingCursor = null;

    let result: MailLiveRefreshResult;
    try {
      result = await options.refresh();
    } catch {
      result = "failed";
    }
    running = false;
    if (disposed) return;

    if (result === "applied") {
      failedAttempts = 0;
      options.onApplied(cursor);
    } else if (result === "failed") {
      pending = true;
      if (!pendingCursor) pendingCursor = cursor;
      failedAttempts += 1;
      options.onFailed(failedAttempts);
      const base = options.retryBaseMs ?? 1_000;
      const maximum = options.retryMaxMs ?? 15_000;
      arm(Math.min(maximum, base * 2 ** Math.min(failedAttempts - 1, 5)));
      return;
    } else {
      pending = true;
      if (!pendingCursor) pendingCursor = cursor;
    }
    arm();
  };

  return {
    schedule: (cursor) => {
      if (disposed) return;
      pending = true;
      if (cursor) pendingCursor = cursor;
      arm();
    },
    resume: arm,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};
