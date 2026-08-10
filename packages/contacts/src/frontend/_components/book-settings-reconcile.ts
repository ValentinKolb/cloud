type ReconciliationState = {
  reconciling: boolean;
  error: string | null;
};

export const createQueuedReconciliation = (reload: () => Promise<void>, updateState: (state: ReconciliationState) => void) => {
  let disposed = false;
  let running = false;
  let error: string | null = null;
  const queue: string[] = [];

  const drain = async (): Promise<void> => {
    if (disposed || running || error || queue.length === 0) return;
    running = true;
    updateState({ reconciling: true, error: null });
    try {
      while (!disposed && queue.length > 0) {
        const message = queue[0]!;
        try {
          await reload();
          queue.shift();
        } catch {
          if (disposed) return;
          error = message;
          break;
        }
      }
    } finally {
      running = false;
      if (!disposed) updateState({ reconciling: false, error });
    }
  };

  const run = (message: string) => {
    if (disposed) return;
    queue.push(message);
    void drain();
  };

  const retry = async (): Promise<void> => {
    if (disposed || !error) return;
    error = null;
    await drain();
  };

  const dispose = () => {
    disposed = true;
    queue.length = 0;
    error = null;
  };

  return { run, retry, dispose };
};

export const settingsInteractionBlocked = (state: {
  writePending: boolean;
  childWritePending: boolean;
  coveragePending: boolean;
  coverageError: boolean;
}): boolean => state.writePending || state.childWritePending || state.coveragePending || state.coverageError;

export const createBlockedReconciliation = (reload: () => Promise<void>, updateState: (state: ReconciliationState) => void) => {
  let disposed = false;
  let pendingResolve: (() => void) | null = null;
  let failureMessage: string | null = null;

  const run = async (message: string): Promise<void> => {
    updateState({ reconciling: true, error: null });
    try {
      await reload();
      if (!disposed) updateState({ reconciling: false, error: null });
    } catch {
      if (disposed) return;
      failureMessage = message;
      updateState({ reconciling: false, error: message });
      await new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }
  };

  const retry = async (): Promise<void> => {
    if (disposed || !pendingResolve || !failureMessage) return;
    updateState({ reconciling: true, error: null });
    try {
      await reload();
      if (disposed) return;
      const resolve = pendingResolve;
      pendingResolve = null;
      failureMessage = null;
      updateState({ reconciling: false, error: null });
      resolve();
    } catch {
      if (!disposed) updateState({ reconciling: false, error: failureMessage });
    }
  };

  const dispose = () => {
    disposed = true;
    pendingResolve?.();
    pendingResolve = null;
    failureMessage = null;
  };

  return { run, retry, dispose };
};
