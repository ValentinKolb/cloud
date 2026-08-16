const tails = new Map<string, Promise<void>>();

export const serializeWorkspaceState = async <T>(baseShortId: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const previous = tails.get(baseShortId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted) throw signal.reason ?? new Error("Workspace state request aborted");
      return load();
    });
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  tails.set(baseShortId, tail);
  try {
    return await current;
  } finally {
    if (tails.get(baseShortId) === tail) tails.delete(baseShortId);
  }
};
