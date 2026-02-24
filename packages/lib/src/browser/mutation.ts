import { createSignal, type Accessor } from "solid-js";

/**
 * Interface for the return type of createMutation.
 *
 * @template T - The type of data returned by the mutation.
 * @template V - The type of variables passed to the mutation.
 * @template C - The base type of the context returned by the onBefore hook.
 */
export interface CreateMutationResult<T, V, C = unknown> {
  /** Signal returning the mutation data or null */
  data: Accessor<T | null>;
  /** Signal returning the error or null */
  error: Accessor<Error | null>;
  /** Signal indicating whether the mutation is in progress */
  loading: Accessor<boolean>;
  /**
   * Triggers the mutation with the given variables.
   * Returns a Promise that resolves when the mutation is complete.
   * The `onBefore` hook is executed during this call.
   */
  mutate: (vars: V) => Promise<void>;
  /**
   * Aborts the current running mutation (if any).
   * The mutation function must support cancellation via an AbortSignal passed in the context.
   */
  abort: () => void;
  /**
   * Retries the last mutation using the same arguments and base context as the previous call.
   * **Note:** The `onBefore` hook is NOT re‑executed on retry, so any one‑time side effects will not occur again.
   */
  retry: () => Promise<void>;
}

/**
 * Options for the mutation.
 *
 * @template T - The type of data returned by the mutation function.
 * @template V - The type of variables passed to the mutation function.
 * @template C - The base type of the context returned by the onBefore hook.
 */
export interface MutationOptions<T, V, C = unknown> {
  /**
   * The initial value of the mutation.
   * If not provided, the mutation will start with an undefined value.
   * If provided, the inital value will be returned as the data.
   */
  initialData?: T;

  /**
   * The mutation function.
   * It receives the mutation variables and a combined context.
   * **Note:** The context will always include an `abortSignal` property.
   * Must return a Promise of type T.
   */
  mutation: (vars: V, ctx: C & { abortSignal: AbortSignal }) => Promise<T>;

  /**
   * Optional hook executed before the mutation starts.
   * It receives the mutation variables and should return a base context (ctx)
   * that will later be extended with the abort signal.
   * It can also return a Promise.
   */
  onBefore?: (vars: V) => C | Promise<C>;

  /**
   * Optional callback executed when the mutation is successful.
   * It receives the mutation result and the combined context.
   */
  onSuccess?: (data: T, ctx?: C & { abortSignal: AbortSignal }) => void;

  /**
   * Optional callback executed if an error occurs during the mutation or in onBefore.
   * It receives the error and the combined context.
   */
  onError?: (error: Error, ctx?: C & { abortSignal: AbortSignal }) => void;

  /**
   * Optional callback executed if the mutation is aborted.
   * It receives the combined context.
   * This hook is only called if the mutation was aborted with the `abort` function,
   * not if another abort signal was triggered.
   */
  onAbort?: (ctx?: C & { abortSignal: AbortSignal }) => void;

  /**
   * Optional callback executed after the mutation completes,
   * regardless of success, error, or abort.
   * This callback is called after loading is set to false.
   * It receives the combined context.
   */
  onFinally?: (ctx?: C & { abortSignal: AbortSignal }) => void;
}

/**
 * A custom hook to handle mutations similarly to React Query's mutation.
 * It provides type‑safe signals for data, error, and loading states, as well as:
 *
 * - a `mutate` function to trigger the mutation (executing the `onBefore` hook),
 * - an `abort` function to cancel the current mutation, and
 * - a `retry` function to re‑execute the last mutation using the same variables and base context.
 *
 * **Note:** The `retry()` method re‑uses the base context from the previous execution
 * and does not call `onBefore` again. Use this if you wish to perform one‑time side effects
 * (in `onBefore`) that should not be repeated on retries.
 *
 * @template T - The type of data returned by the mutation.
 * @template V - The type of variables passed to the mutation function.
 * @template C - The base type of the context returned by the onBefore hook.
 *
 * @param options - The options for the mutation.
 * @returns An object containing the mutation signals and functions.
 */
export function createMutation<T, V, C = unknown>(options: MutationOptions<T, V, C>): CreateMutationResult<T, V, C> {
  // Create signals for data, error, and loading state.
  const [data, setData] = createSignal<T | null>(options.initialData ?? null);
  const [error, setError] = createSignal<Error | null>(null);
  const [loading, setLoading] = createSignal<boolean>(false);

  // Store the current AbortController so we can cancel the mutation.
  let currentAbortController: AbortController | null = null;

  // Optionally store the current combined context (base context merged with the abort signal).
  let currentCtx: (C & { abortSignal: AbortSignal }) | undefined;

  // Store the last mutation variables and base context to allow retrying without re‑executing onBefore.
  let lastVars: V | undefined;
  let lastBaseCtx: C | undefined;

  /**
   * Helper to update the data signal safely.
   *
   * SolidJS interprets functions passed to setters as updater functions.
   * Wrapping a function in an arrow function ensures it is stored as a literal value.
   *
   * @param value - The new data value.
   */
  const safeSetData = (value: T) => {
    if (typeof value === "function") {
      setData(() => value);
    } else {
      setData(value as Exclude<T, Function>);
    }
  };

  /**
   * Private helper that runs the mutation.
   *
   * @param vars - The mutation variables.
   * @param baseCtx - An optional base context. If provided, the onBefore hook is NOT re‑executed.
   */
  async function runMutation(vars: V, baseCtx?: C): Promise<void> {
    // Store the latest variables and base context (may be undefined).
    lastVars = vars;
    if (baseCtx !== undefined) {
      lastBaseCtx = baseCtx;
    }
    setLoading(true);
    setError(null);

    // Create a new AbortController for this mutation.
    currentAbortController = new AbortController();

    // Combine the provided base context (if any) with the new abort signal.
    const combinedCtx = {
      ...(baseCtx && typeof baseCtx === "object" ? baseCtx : {}),
      abortSignal: currentAbortController.signal,
    } as C & { abortSignal: AbortSignal };
    // Store the combined context for potential abort callbacks.
    currentCtx = combinedCtx;

    try {
      const result = await options.mutation(vars, combinedCtx);

      // If the mutation was aborted, trigger the onAbort callback.
      if (currentAbortController.signal.aborted) {
        if (options.onAbort) {
          options.onAbort(currentCtx);
        }
      } else {
        safeSetData(result);
        if (options.onSuccess) {
          options.onSuccess(result, combinedCtx);
        }
      }
    } catch (err: any) {
      setError(err);
      if (options.onError) {
        options.onError(err, currentCtx);
      }
    } finally {
      setLoading(false);
      if (options.onFinally) {
        options.onFinally(currentCtx);
      }
      currentAbortController = null;
      currentCtx = undefined;
    }
  }

  /**
   * Triggers the mutation using the provided variables.
   * This method executes the `onBefore` hook (if provided) to obtain the base context.
   *
   * @param vars - The variables to pass to the mutation function.
   */
  const mutate = async (vars: V): Promise<void> => {
    let baseCtx: C | undefined = undefined;
    if (options.onBefore) {
      // Execute onBefore and store its result.
      baseCtx = await options.onBefore(vars);
      lastBaseCtx = baseCtx;
    }
    await runMutation(vars, baseCtx);
  };

  /**
   * Aborts the currently running mutation, if any.
   * The mutation function must support cancellation via the abort signal provided in the context.
   */
  const abort = () => {
    if (currentAbortController) {
      currentAbortController.abort();
    }
  };

  /**
   * Retries the last mutation using the same arguments and base context as the previous call.
   * **Note:** The onBefore hook is NOT re‑executed on retry, so any one‑time side effects will not occur again.
   */
  const retry = async (): Promise<void> => {
    if (lastVars !== undefined) {
      await runMutation(lastVars, lastBaseCtx);
    }
  };

  return { data, error, loading, mutate, abort, retry };
}

export const mutation = {
  create: createMutation,
} as const;
