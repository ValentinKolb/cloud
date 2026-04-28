import type { Context } from "hono";
import { isServiceError, type Result } from "@valentinkolb/stdlib";

type LegacyResult<T = void> = { ok: true; data: T } | { ok: false; error: string; status: number };

type AnyResult<T = unknown> = Result<T> | LegacyResult<T>;

type ErrorResponseBody = {
  message: string;
  code?: string;
};

const toErrorResponse = (result: AnyResult): [ErrorResponseBody, number] => {
  if (result.ok) {
    throw new Error("toErrorResponse called with successful result");
  }

  // Legacy shape: { ok: false, error: string, status: number }
  if ("status" in result && typeof result.status === "number") {
    return [{ message: result.error }, result.status];
  }

  // New shape: { ok: false, error: ServiceError }
  if (isServiceError(result.error)) {
    return [
      {
        message: result.error.message,
        code: result.error.code,
      },
      result.error.status,
    ];
  }

  // Defensive fallback
  return [{ message: "Internal server error", code: "INTERNAL" }, 500];
};

export const respond = async <T>(
  c: Context,
  resultOrFn: AnyResult<T> | Promise<AnyResult<T>> | (() => AnyResult<T> | Promise<AnyResult<T>>),
  successStatus = 200,
) => {
  const result = typeof resultOrFn === "function" ? await resultOrFn() : await resultOrFn;

  if (!result.ok) {
    const [body, status] = toErrorResponse(result);
    return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 500);
  }

  return c.json(result.data, successStatus as 200 | 201);
};

export const api = {
  respond,
} as const;
