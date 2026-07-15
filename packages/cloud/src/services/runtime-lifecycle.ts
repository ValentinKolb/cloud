export type RuntimeTaskTracker = ReturnType<typeof createRuntimeTaskTracker>;

export const createRuntimeTaskTracker = () => {
  const tasks = new Set<Promise<unknown>>();
  let accepting = false;

  return {
    open: (): void => {
      accepting = true;
    },
    close: (): void => {
      accepting = false;
    },
    run: <T>(operation: () => Promise<T>): Promise<T> | null => {
      if (!accepting) return null;
      const task = Promise.resolve().then(operation);
      tasks.add(task);
      const remove = () => tasks.delete(task);
      task.then(remove, remove);
      return task;
    },
    drain: async (): Promise<void> => {
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },
  };
};

export const stopRuntimeJobs = async (
  tracker: Pick<RuntimeTaskTracker, "close" | "drain">,
  jobs: ReadonlyArray<{ stop(): void }>,
): Promise<void> => {
  tracker.close();
  for (const job of jobs) job.stop();
  await tracker.drain();
  // An accepted task may restart its worker before the drain completes.
  for (const job of jobs) job.stop();
};

type RuntimeLifecycleHooks = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export const createRuntimeLifecycle = (hooks: RuntimeLifecycleHooks) => {
  let state: "stopped" | "started" | "cleanup-required" = "stopped";
  let transition = Promise.resolve();

  const serialize = (operation: () => Promise<void>): Promise<void> => {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  };

  return {
    start: (): Promise<void> =>
      serialize(async () => {
        if (state === "started") return;
        if (state === "cleanup-required") {
          await hooks.stop();
          state = "stopped";
        }

        state = "cleanup-required";
        try {
          await hooks.start();
          state = "started";
        } catch (startError) {
          try {
            await hooks.stop();
            state = "stopped";
          } catch (stopError) {
            throw new AggregateError([startError, stopError], "Runtime startup and cleanup failed");
          }
          throw startError;
        }
      }),
    stop: (): Promise<void> =>
      serialize(async () => {
        if (state === "stopped") return;
        state = "cleanup-required";
        await hooks.stop();
        state = "stopped";
      }),
  };
};

export const stopRuntimeResources = async (resources: ReadonlyArray<() => void | Promise<void>>): Promise<void> => {
  const errors: unknown[] = [];
  for (const stop of resources) {
    try {
      await stop();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Multiple runtime resources failed to stop");
};
