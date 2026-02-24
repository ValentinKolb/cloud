import { ipa } from "@valentinkolb/cloud/core/services";
import {
  fail,
  ok,
  paginate,
  type PageParams,
  type Paginated,
  type Result,
  type ServiceErrorCode,
} from "@valentinkolb/cloud/lib/server";
import type { IpaHost, IpaHostgroup } from "@/hosts/contracts";

type IpaMutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };

/**
 * Builds the shared paginated response shape from external IPA list results.
 */
const toPaginated = <T>(items: T[], total: number, pagination: { page: number; perPage: number }): Paginated<T> => ({
  items,
  page: pagination.page,
  perPage: pagination.perPage,
  total,
  hasNext: pagination.page * pagination.perPage < total,
});

/**
 * Maps IPA HTTP-style status codes to the shared service error code enum.
 */
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
    case 500:
    default:
      return "INTERNAL";
  }
};

/**
 * Converts legacy IPA mutation responses into the standardized `Result<void>` shape.
 */
const fromIpaMutation = (result: IpaMutationResult): Result<void> => {
  if (result.ok) return ok();
  return fail({
    code: toErrorCode(result.status),
    message: result.error,
    status: result.status,
  });
};

export const hostsService = {
  host: {
    list: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipa.hosts.list({
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHost>(result.hosts, result.total, { page, perPage });
    },
    listByGroup: async (config: { hostgroupCn: string; pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipa.hosts.listByGroup(config.hostgroupCn, {
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHost>(result.hosts, result.total, { page, perPage });
    },
    update: async (config: { ipaSession: string; fqdn: string; data: { location?: string; locality?: string; description?: string } }) => {
      const result = await ipa.hosts.mod(config.ipaSession, config.fqdn, config.data);
      return fromIpaMutation(result);
    },
    remove: async (config: { ipaSession: string; fqdn: string }) => {
      const result = await ipa.hosts.del(config.ipaSession, config.fqdn);
      return fromIpaMutation(result);
    },
    addToGroup: async (config: { ipaSession: string; fqdn: string; hostgroup: string }) => {
      const result = await ipa.hosts.addToGroup(config.ipaSession, config.fqdn, config.hostgroup);
      return fromIpaMutation(result);
    },
    removeFromGroup: async (config: { ipaSession: string; fqdn: string; hostgroup: string }) => {
      const result = await ipa.hosts.removeFromGroup(config.ipaSession, config.fqdn, config.hostgroup);
      return fromIpaMutation(result);
    },
  },
  hostgroup: {
    list: async (config: { pagination?: PageParams; filter?: { query?: string } }) => {
      const { page, perPage } = paginate(config.pagination);
      const result = await ipa.hostgroups.list({
        search: config.filter?.query,
        page,
        perPage,
      });
      return toPaginated<IpaHostgroup>(result.hostgroups, result.total, { page, perPage });
    },
    search: async (config: { query: string; exclude?: string[]; limit?: number }) => {
      const excludeSet = new Set(config.exclude ?? []);
      const { hostgroups } = await ipa.hostgroups.list({
        search: config.query,
        perPage: config.limit ?? 10,
      });
      return hostgroups.filter((hostgroup) => !excludeSet.has(hostgroup.cn));
    },
    create: async (config: { ipaSession: string; name: string; description?: string }) => {
      const result = await ipa.hostgroups.add(config.ipaSession, config.name, {
        description: config.description,
      });
      return fromIpaMutation(result);
    },
    update: async (config: { ipaSession: string; cn: string; data: { description?: string } }) => {
      const result = await ipa.hostgroups.mod(config.ipaSession, config.cn, config.data);
      return fromIpaMutation(result);
    },
    remove: async (config: { ipaSession: string; cn: string }) => {
      const result = await ipa.hostgroups.del(config.ipaSession, config.cn);
      return fromIpaMutation(result);
    },
  },
};

export type HostsService = typeof hostsService;
