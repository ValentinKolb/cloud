export const FREEIPA_REQUEST_TIMEOUT_MS = 30_000;
export const FREEIPA_ERROR_BODY_LIMIT_BYTES = 8 * 1024;

export type FreeIpaTransportErrorKind = "aborted" | "invalid_response" | "network" | "timeout" | "tls" | "upstream";

export class FreeIpaTransportError extends Error {
  readonly kind: FreeIpaTransportErrorKind;
  readonly status: number | null;

  constructor(kind: FreeIpaTransportErrorKind, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FreeIpaTransportError";
    this.kind = kind;
    this.status = options.status ?? null;
  }
}

const isTlsError = (error: unknown): boolean => {
  const text = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "",
    error instanceof Error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause
      ? String(error.cause.code)
      : "",
  ]
    .join(" ")
    .toLowerCase();

  return /certificate|cert_|hostname|self[- ]signed|ssl|tls|unable to verify|unknown ca/.test(text);
};

export const withFreeIpaResponse = async <T>(
  input: string | URL,
  init: BunFetchRequestInit,
  consume: (response: Response) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> => {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? FREEIPA_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let timeout!: ReturnType<typeof setTimeout>;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("FreeIPA request timed out", "TimeoutError"));
      reject(new FreeIpaTransportError("timeout", `FreeIPA request timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  let rejectCallerAbort: ((error: FreeIpaTransportError) => void) | null = null;
  const callerAbortFailure = new Promise<never>((_, reject) => {
    rejectCallerAbort = reject;
  });
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason);
    rejectCallerAbort?.(new FreeIpaTransportError("aborted", "FreeIPA request was cancelled"));
  };

  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeoutFailure, callerAbortFailure]);
    return await Promise.race([consume(response), timeoutFailure, callerAbortFailure]);
  } catch (error) {
    if (error instanceof FreeIpaTransportError) throw error;
    if (timedOut) {
      throw new FreeIpaTransportError("timeout", `FreeIPA request timed out after ${timeoutMs} ms`, { cause: error });
    }
    if (options.signal?.aborted) {
      throw new FreeIpaTransportError("aborted", "FreeIPA request was cancelled", { cause: error });
    }
    if (isTlsError(error)) {
      throw new FreeIpaTransportError("tls", "FreeIPA TLS verification failed", { cause: error });
    }
    throw new FreeIpaTransportError("network", "Could not connect to FreeIPA", { cause: error });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
};

export const readFreeIpaErrorBody = async (
  response: Response,
  maxBytes = FREEIPA_ERROR_BODY_LIMIT_BYTES,
): Promise<{ text: string; truncated: boolean }> => {
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (bytesRead <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), truncated: false };
      if (!value) continue;

      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true });
        return { text: text + decoder.decode(), truncated: true };
      }
      bytesRead += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), truncated: true };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

export const isFreeIpaUpstreamStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500;

export const upstreamFreeIpaError = (status: number): FreeIpaTransportError =>
  new FreeIpaTransportError("upstream", `FreeIPA returned HTTP ${status}`, { status });
