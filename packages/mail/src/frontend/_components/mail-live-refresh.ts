export type MailLiveRefreshResult = "applied" | "failed" | "stale";

type MailLiveRefreshCoordinator = {
  schedule: (cursor?: string | null) => void;
  resume: () => void;
  dispose: () => void;
};

export const createMailLiveRefreshCoordinator = (options: {
  delayMs: number;
  isBlocked: () => boolean;
  refresh: () => Promise<MailLiveRefreshResult>;
  onApplied: (cursor: string | null) => void;
  onFailed: () => void;
}): MailLiveRefreshCoordinator => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let pendingCursor: string | null = null;
  let disposed = false;

  const arm = () => {
    if (disposed || running || timer || !pending || options.isBlocked()) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, options.delayMs);
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

    if (result === "applied") options.onApplied(cursor);
    else if (result === "failed") {
      disposed = true;
      options.onFailed();
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
