import { ipaHosts } from "../backend";
import {
  fail,
  ok,
  paginate,
  type PageParams,
  type Paginated,
  type Result,
  type ServiceErrorCode,
} from "@valentinkolb/cloud/server";
import type { IpaHost, IpaHostgroup } from "@/contracts";

type IpaMutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };

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
    update: async (config: {
      ipaSession: string;
      fqdn: string;
      data: { location?: string; locality?: string; description?: string; macAddress?: string[] };
    }) => {
      const result = await ipaHosts.hosts.update(config.ipaSession, config.fqdn, config.data);
      return fromIpaMutation(result);
    },
    remove: async (config: { ipaSession: string; fqdn: string }) => {
      const result = await ipaHosts.hosts.delete(config.ipaSession, config.fqdn);
      return fromIpaMutation(result);
    },
    addToGroup: async (config: { ipaSession: string; fqdn: string; hostgroup: string }) => {
      const result = await ipaHosts.hosts.addToGroup(config.ipaSession, config.fqdn, config.hostgroup);
      return fromIpaMutation(result);
    },
    removeFromGroup: async (config: { ipaSession: string; fqdn: string; hostgroup: string }) => {
      const result = await ipaHosts.hosts.removeFromGroup(config.ipaSession, config.fqdn, config.hostgroup);
      return fromIpaMutation(result);
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
    create: async (config: { ipaSession: string; name: string; description?: string }) => {
      const result = await ipaHosts.hostgroups.create(config.ipaSession, config.name, {
        description: config.description,
      });
      return fromIpaMutation(result);
    },
    update: async (config: { ipaSession: string; cn: string; data: { description?: string } }) => {
      const result = await ipaHosts.hostgroups.update(config.ipaSession, config.cn, config.data);
      return fromIpaMutation(result);
    },
    remove: async (config: { ipaSession: string; cn: string }) => {
      const result = await ipaHosts.hostgroups.delete(config.ipaSession, config.cn);
      return fromIpaMutation(result);
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
