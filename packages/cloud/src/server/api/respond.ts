import type { Context, TypedResponse } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { isServiceError, ok, type Result, type ServiceError } from "@valentinkolb/stdlib";

type LegacyResult<T = void> = { ok: true; data: T } | { ok: false; error: string; status: number };

type AnyResult<T = unknown> = Result<T> | LegacyResult<T>;
type ResultOrFn<T> = T | Promise<T> | (() => T | Promise<T>);
type SuccessStatus = 200 | 201;
type ErrorStatus = ServiceError["status"];
type JsonTypedResponse<T, Status extends StatusCode> = TypedResponse<T, Status, "json">;

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

export async function respond<E extends ServiceError>(
  c: Context,
  resultOrFn: ResultOrFn<Result<never, E>>,
  successStatus?: SuccessStatus,
): Promise<JsonTypedResponse<ErrorResponseBody, E["status"]>>;
export async function respond<T>(
  c: Context,
  resultOrFn: ResultOrFn<Result<T, never>>,
  successStatus?: SuccessStatus,
): Promise<JsonTypedResponse<T, SuccessStatus>>;
export async function respond<T, E extends ServiceError>(
  c: Context,
  resultOrFn: ResultOrFn<Result<T, E>>,
  successStatus?: SuccessStatus,
): Promise<JsonTypedResponse<T, SuccessStatus> | JsonTypedResponse<ErrorResponseBody, E["status"]>>;
export async function respond<T>(
  c: Context,
  resultOrFn: ResultOrFn<AnyResult<T>>,
  successStatus?: SuccessStatus,
): Promise<JsonTypedResponse<T, SuccessStatus> | JsonTypedResponse<ErrorResponseBody, ErrorStatus>>;
export async function respond<T>(
  c: Context,
  resultOrFn: ResultOrFn<AnyResult<T>>,
  successStatus: SuccessStatus = 200,
): Promise<JsonTypedResponse<T, SuccessStatus> | JsonTypedResponse<ErrorResponseBody, ErrorStatus>> {
  const result = typeof resultOrFn === "function" ? await resultOrFn() : await resultOrFn;

  if (!result.ok) {
    const [body, status] = toErrorResponse(result);
    return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 500) as JsonTypedResponse<ErrorResponseBody, ErrorStatus>;
  }

  return c.json(result.data, successStatus as 200 | 201) as JsonTypedResponse<T, SuccessStatus>;
}

export const respondMessage = (c: Context, resultPromise: Promise<Result<void>>, message: string) =>
  respond(c, async () => {
    const result = await resultPromise;
    if (!result.ok) return result;
    return ok({ message });
  });

export const api = {
  respond,
  respondMessage,
} as const;
