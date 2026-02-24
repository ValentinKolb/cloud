import { oauth } from "./oauth";
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
import type { MutationResult } from "@/oauth/contracts";

type OAuthClient = Awaited<ReturnType<typeof oauth.clients.list>>[number];
type MutationStatus = Extract<MutationResult, { ok: false }>["status"];

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
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
const toServiceError = (status: MutationStatus, message: string): ServiceError => {
  if (status === 400) return err.badInput(message);
  if (status === 401) return err.unauthenticated(message);
  if (status === 403) return err.forbidden(message);
  if (status === 404) return err.notFound("Client");
  if (status === 409) return { code: "CONFLICT", message, status };
  return err.internal(message);
};

const fromMutation = <T>(result: MutationResult<T>): Result<T> => {
  if (result.ok) return ok(result.data);
  return fail(toServiceError(result.status, result.error));
};

export const oauthService = {
  client: {
    list: async (config?: { pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<OAuthClient>> => {
      const clients = await oauth.clients.list();
      const query = config?.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? clients.filter((client) => {
              const description = client.description ?? "";
              return (
                client.name.toLowerCase().includes(query) ||
                client.clientId.toLowerCase().includes(query) ||
                description.toLowerCase().includes(query)
              );
            })
          : clients;

      return paginateItems(filtered, config?.pagination);
    },
    get: async (config: { id: string }) => oauth.clients.get({ id: config.id }),
    create: async (config: { data: Parameters<typeof oauth.clients.create>[0]["data"]; createdBy: string }) =>
      fromMutation(await oauth.clients.create(config)),
    update: async (config: { id: string; data: Parameters<typeof oauth.clients.update>[0]["data"] }) =>
      fromMutation(await oauth.clients.update(config)),
    remove: async (config: { id: string }) => fromMutation(await oauth.clients.delete_(config)),
    regenerateSecret: async (config: { id: string }) => fromMutation(await oauth.clients.regenerateSecret(config)),
  },
};

export type OauthService = typeof oauthService;
