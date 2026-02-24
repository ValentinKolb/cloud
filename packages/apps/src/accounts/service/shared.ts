import {
  err,
  fail,
  ok,
  paginate,
  type PageParams,
  type Paginated,
  type Result,
  type ServiceError,
} from "@valentinkolb/cloud/lib/server";
import type { MutationResult } from "@/accounts/contracts";

type MutationErrorStatus = Extract<MutationResult, { ok: false }>["status"];

export const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const pagedItems = items.slice(offset, offset + perPage);
  return {
    items: pagedItems,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

/**
 * Maps legacy mutation status codes into the shared service error format.
 */
const toServiceError = (status: MutationErrorStatus, message: string): ServiceError => {
  if (status === 400) return err.badInput(message);
  if (status === 401) return err.unauthenticated(message);
  if (status === 403) return err.forbidden(message);
  if (status === 404) return { code: "NOT_FOUND", message, status };
  if (status === 409) return { code: "CONFLICT", message, status };
  return err.internal(message);
};

export const fromMutationResult = <T>(result: MutationResult<T>): Result<T> => {
  if (result.ok) return ok(result.data);
  return fail(toServiceError(result.status, result.error));
};
