export type IpaSyncRuntime = {
  signal?: AbortSignal;
  heartbeat?: () => Promise<void>;
};

export const createIpaRuntimeCheckpoint = (
  runtime: IpaSyncRuntime,
  options: {
    intervalMs?: number;
    now?: () => number;
    onHeartbeat?: () => void;
  } = {},
): ((force?: boolean) => Promise<void>) => {
  const intervalMs = options.intervalMs ?? 30_000;
  const now = options.now ?? Date.now;
  let lastHeartbeatAt: number | null = null;

  return async (force = false) => {
    if (runtime.signal?.aborted) throw new DOMException("FreeIPA operation was cancelled", "AbortError");
    const currentTime = now();
    if (runtime.heartbeat && (force || lastHeartbeatAt === null || currentTime - lastHeartbeatAt >= intervalMs)) {
      await runtime.heartbeat();
      lastHeartbeatAt = now();
      options.onHeartbeat?.();
    }
    if (runtime.signal?.aborted) throw new DOMException("FreeIPA operation was cancelled", "AbortError");
  };
};
