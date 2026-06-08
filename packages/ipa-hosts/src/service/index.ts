import { ipaHosts } from "../backend";
import { getFreeIpaConfig } from "@valentinkolb/cloud/services/freeipa-config";
import {
  err,
  fail,
  freeipa,
  ok,
  paginate,
  type PageParams,
  type Paginated,
  type Result,
  type ServiceErrorCode,
} from "@valentinkolb/cloud/server";
import type { IpaHost, IpaHostgroup } from "@/contracts";

type IpaMutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };
type IpaHostsActor = { userId: string; uid: string; roles: string[]; provider?: string | null };

const looksLikeCronValidationError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return ["cron", "expression", "field", "minute", "hour", "day", "month", "weekday"].some((token) => message.includes(token));
};

const toPaginated = <T>(items: T[], total: number, pagination: { page: number; perPage: number }): Paginated<T> => ({
  items,
  page: pagination.page,
  perPage: pagination.perPage,
  total,
  hasNext: pagination.page * pagination.perPage < total,
});

const toErrorCode = (status: 400 | 401 | 403 | 404 | 500): ServiceErrorCode => {
  switch (status) {
    case 400:
      return "BAD_INPUT";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    default:
      return "INTERNAL";
  }
};

const fromIpaMutation = (result: IpaMutationResult): Result<void> => {
  if (result.ok) return ok();
  return fail({
    code: toErrorCode(result.status),
    message: result.error,
    status: result.status,
  });
};

const getServiceSession = async (): Promise<Result<string>> => {
  const config = await getFreeIpaConfig();
  if (!config.enabled) return fail(err.badInput("FreeIPA is disabled."));
  if (!config.configured) return fail(err.badInput("FreeIPA is enabled but not fully configured."));
  try {
    return ok(await freeipa.session.getServiceSession({
      url: config.url,
      serviceUser: config.serviceUser,
      servicePassword: config.servicePassword,
    }));
  } catch {
    return fail(err.internal("Internal FreeIPA service session unavailable."));
  }
};

const isAdminActor = (actor: IpaHostsActor): boolean => actor.roles.includes("admin");

const getAdminServiceSession = async (actor: IpaHostsActor): Promise<Result<string>> => {
  if (!isAdminActor(actor)) return fail(err.forbidden("Admin access required"));
  return getServiceSession();
};

const runAdminMutation = async (
  actor: IpaHostsActor,
  mutation: (ipaSession: string) => Promise<IpaMutationResult>,
): Promise<Result<void>> => {
  const serviceSession = await getAdminServiceSession(actor);
  if (!serviceSession.ok) return serviceSession;
  const result = await mutation(serviceSession.data);
  return fromIpaMutation(result);
};

export const ipaHostsService = {
  host: {
    list: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipaHosts.hosts.list({
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHost>(result.hosts, result.total, { page, perPage });
    },
    listUngrouped: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipaHosts.hosts.listUngrouped({
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHost>(result.hosts, result.total, { page, perPage });
    },
    update: async (config: { actor: IpaHostsActor; fqdn: string; data: { location?: string; locality?: string; description?: string; macAddress?: string[] } }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hosts.update(ipaSession, config.fqdn, config.data));
    },
    remove: async (config: { actor: IpaHostsActor; fqdn: string }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hosts.delete(ipaSession, config.fqdn));
    },
    addToGroup: async (config: { actor: IpaHostsActor; fqdn: string; hostgroup: string }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hosts.addToGroup(ipaSession, config.fqdn, config.hostgroup));
    },
    removeFromGroup: async (config: { actor: IpaHostsActor; fqdn: string; hostgroup: string }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hosts.removeFromGroup(ipaSession, config.fqdn, config.hostgroup));
    },
  },
  hostgroup: {
    list: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipaHosts.hostgroups.list({
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHostgroup>(result.hostgroups, result.total, { page, perPage });
    },
    listWithHosts: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipaHosts.hostgroups.listWithHosts({
        search: config.filter?.query,
        page,
        perPage,
      });
      return {
        items: result.hostgroups,
        page,
        perPage,
        total: result.total,
        hasNext: page * perPage < result.total,
      };
    },
    search: async (config: { query: string; exclude?: string[]; limit?: number }) => {
      return ipaHosts.hostgroups.search({
        query: config.query,
        exclude: config.exclude,
        limit: config.limit,
      });
    },
    create: async (config: { actor: IpaHostsActor; name: string; description?: string }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hostgroups.create(ipaSession, config.name, {
        description: config.description,
      }));
    },
    update: async (config: { actor: IpaHostsActor; cn: string; data: { description?: string } }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hostgroups.update(ipaSession, config.cn, config.data));
    },
    remove: async (config: { actor: IpaHostsActor; cn: string }) => {
      return runAdminMutation(config.actor, (ipaSession) => ipaHosts.hostgroups.delete(ipaSession, config.cn));
    },
  },
  sync: {
    getCron: async () => ipaHosts.sync.getCron(),
    getTimezone: async () => ipaHosts.sync.getTimezone(),
    updateCron: async (config: { cron: string }) => {
      try {
        await ipaHosts.sync.updateCron(config.cron);
        return ok();
      } catch (error) {
        const isBadInput = looksLikeCronValidationError(error);
        return fail({
          code: isBadInput ? "BAD_INPUT" : "INTERNAL",
          message: error instanceof Error ? error.message : "Failed to update sync schedule.",
          status: isBadInput ? 400 : 500,
        });
      }
    },
    run: async () => ipaHosts.sync.submit(),
  },
  stats: async () => ipaHosts.stats(),
};

export type IpaHostsService = typeof ipaHostsService;
