export const withLeaseHeartbeat = async <T>(params: {
  intervalMs: number;
  heartbeat: () => Promise<void>;
  work: (assertLeaseActive: () => Promise<void>, signal: AbortSignal) => Promise<T>;
}): Promise<T> => {
  if (!Number.isSafeInteger(params.intervalMs) || params.intervalMs < 1) {
    throw new Error("Lease heartbeat interval must be a positive integer");
  }

  let stopped = false;
  let heartbeatFailed = false;
  let heartbeatError: unknown;
  const abortController = new AbortController();
  let heartbeatChain = Promise.resolve();
  const queueHeartbeat = (): Promise<void> => {
    heartbeatChain = heartbeatChain.then(async () => {
      if (stopped || heartbeatFailed) return;
      try {
        await params.heartbeat();
      } catch (error) {
        heartbeatFailed = true;
        heartbeatError = error;
        abortController.abort(error);
      }
    });
    return heartbeatChain;
  };
  const assertLeaseActive = async (): Promise<void> => {
    await queueHeartbeat();
    if (heartbeatFailed) throw heartbeatError;
  };
  const timer = setInterval(() => {
    void queueHeartbeat();
  }, params.intervalMs);

  let workFailed = false;
  let workError: unknown;
  let result!: T;
  try {
    await assertLeaseActive();
    result = await params.work(assertLeaseActive, abortController.signal);
  } catch (error) {
    workFailed = true;
    workError = error;
  } finally {
    stopped = true;
    clearInterval(timer);
    await heartbeatChain;
  }

  if (heartbeatFailed) throw heartbeatError;
  if (workFailed) throw workError;
  return result;
};
