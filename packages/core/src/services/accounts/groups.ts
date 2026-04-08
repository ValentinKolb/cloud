import { sql } from "bun";
import type { BaseGroup, GroupMember, MutationResult, UserProvider } from "@valentinkolb/cloud-contracts/shared";
import * as localGroups from "./local-groups";
import { providers } from "../providers";
import { freeipa } from "@valentinkolb/cloud-lib/server/services";
import { toPgUuidArray } from "../postgres";
import { buildBaseGroup } from "./base-group";
import {
  buildManagedGroupScopeCondition,
  buildMemberGroupScopeCondition,
} from "./group-sql";

type DbRow = Record<string, unknown>;

type GroupListScope = "all" | "member" | "managed";

const getGroup = async (id: string): Promise<BaseGroup | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, provider, name, description, gid_number
    FROM auth.groups
    WHERE id = ${id}::uuid
  `;
  if (!row) return null;
  return buildBaseGroup(row);
};

const listCanonical = async (params: {
  ids?: string[];
  userId?: string;
  scope?: GroupListScope;
  search?: string;
  provider?: UserProvider;
  page?: number;
  perPage?: number;
}): Promise<{
  groups: BaseGroup[];
  total: number;
  pagination: { page: number; perPage: number; totalPages: number; hasNext: boolean };
}> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 100;
  const offset = (page - 1) * perPage;
  const pattern = params.search ? `%${freeipa.util.escapeLike(params.search.toLowerCase())}%` : null;
  const ids = params.ids ?? [];
  const scope = params.scope ?? (params.userId ? "member" : "all");
  const scopeUserId = params.userId ?? "00000000-0000-0000-0000-000000000000";
  const idsCondition = ids.length === 0 ? sql`TRUE` : sql`g.id = ANY(${toPgUuidArray(ids)}::uuid[])`;

  if (params.ids && params.ids.length === 0) {
    return {
      groups: [],
      total: 0,
      pagination: {
        page,
        perPage,
        totalPages: 0,
        hasNext: false,
      },
    };
  }

  const countRows = await sql<DbRow[]>`
    SELECT COUNT(*)::int AS total
    FROM auth.groups g
    WHERE (${params.provider ?? null}::text IS NULL OR g.provider = ${params.provider ?? null})
      AND ${idsCondition}
      AND (
        ${scope === "all"} = true
        OR ${params.userId ?? null}::uuid IS NULL
        OR (${scope === "member"} = true AND ${buildMemberGroupScopeCondition({ userId: scopeUserId, groupProvider: sql`g.provider` })})
        OR (${scope === "managed"} = true AND ${buildManagedGroupScopeCondition({ userId: scopeUserId, groupProvider: sql`g.provider` })})
      )
      AND (
        ${pattern}::text IS NULL
        OR LOWER(g.name) LIKE ${pattern} ESCAPE '\\'
        OR LOWER(COALESCE(g.description, '')) LIKE ${pattern} ESCAPE '\\'
      )
  `;

  const rows = await sql<DbRow[]>`
    SELECT g.id, g.provider, g.name, g.description, g.gid_number
    FROM auth.groups g
    WHERE (${params.provider ?? null}::text IS NULL OR g.provider = ${params.provider ?? null})
      AND ${idsCondition}
      AND (
        ${scope === "all"} = true
        OR ${params.userId ?? null}::uuid IS NULL
        OR (${scope === "member"} = true AND ${buildMemberGroupScopeCondition({ userId: scopeUserId, groupProvider: sql`g.provider` })})
        OR (${scope === "managed"} = true AND ${buildManagedGroupScopeCondition({ userId: scopeUserId, groupProvider: sql`g.provider` })})
      )
      AND (
        ${pattern}::text IS NULL
        OR LOWER(g.name) LIKE ${pattern} ESCAPE '\\'
        OR LOWER(COALESCE(g.description, '')) LIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY g.name
    LIMIT ${perPage}
    OFFSET ${offset}
  `;

  const total = Number(countRows[0]?.total ?? 0);
  return {
    groups: rows.map(buildBaseGroup),
    total,
    pagination: {
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      hasNext: page * perPage < total,
    },
  };
};

export const list = async (params: {
  ids?: string[];
  userId?: string;
  scope?: GroupListScope;
  search?: string;
  provider?: UserProvider;
  page?: number;
  perPage?: number;
}) => {
  return listCanonical(params);
};

export const get = async (params: { id: string }): Promise<BaseGroup | null> => {
  return getGroup(params.id);
};

export const getMembers = async (params: { id: string; provider?: UserProvider; type?: "user" | "group"; recursive?: boolean }): Promise<GroupMember[]> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.getMembers(params);
  if (!provider) return [];
  return providers.ipa.groups.getMembers(params);
};

export const getManagers = async (params: { id: string; provider?: UserProvider; type?: "user" | "group"; recursive?: boolean }): Promise<GroupMember[]> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.getManagers(params);
  if (!provider) return [];
  return providers.ipa.groups.getManagers(params);
};

export const getParents = async (params: { id: string; provider?: UserProvider; recursive?: boolean }): Promise<string[]> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.getParents(params);
  if (!provider) return [];
  return providers.ipa.groups.getParents(params);
};

export const getManagedGroups = async (params: { id: string; provider?: UserProvider }): Promise<string[]> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.getManagedGroups(params);
  if (!provider) return [];
  return providers.ipa.groups.getManagedGroups(params);
};

export const create = async (params: {
  ipaSession?: string | null;
  provider: UserProvider;
  name: string;
  description?: string;
  posix?: boolean;
}): Promise<MutationResult<BaseGroup>> => {
  if (params.provider === "local") {
    if (params.posix) return { ok: false, error: "Local groups do not support POSIX mode", status: 400 };
    return localGroups.create({ name: params.name, description: params.description });
  }
  if (!params.ipaSession) return { ok: false, error: "IPA session required to create IPA groups", status: 401 };
  return providers.ipa.groups.add({
    ipaSession: params.ipaSession,
    cn: params.name,
    description: params.description,
    posix: params.posix,
  });
};

export const update = async (params: {
  ipaSession?: string | null;
  id: string;
  provider?: UserProvider;
  description: string;
}): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.update({ id: params.id, description: params.description });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA groups", status: 401 };
  return providers.ipa.groups.update({
    ipaSession: params.ipaSession,
    id: params.id,
    description: params.description,
  });
};

export const remove = async (params: { ipaSession?: string | null; id: string; provider?: UserProvider }): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.remove({ id: params.id });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to delete IPA groups", status: 401 };
  return providers.ipa.groups.remove({
    ipaSession: params.ipaSession,
    id: params.id,
  });
};

export const makePosix = async (params: {
  ipaSession?: string | null;
  id: string;
  provider?: UserProvider;
}): Promise<MutationResult<{ gidnumber: number | null }>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return { ok: false, error: "Local groups do not support POSIX mode", status: 400 };
  if (!params.ipaSession) return { ok: false, error: "IPA session required to change IPA groups", status: 401 };
  return providers.ipa.groups.makePosix({
    ipaSession: params.ipaSession,
    id: params.id,
  });
};

export const addMember = async (params: { ipaSession?: string | null; id: string; provider?: UserProvider; user?: string; group?: string }): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.addMember({ id: params.id, user: params.user, group: params.group });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA groups", status: 401 };
  return providers.ipa.groups.addMember({
    ipaSession: params.ipaSession,
    id: params.id,
    user: params.user,
    group: params.group,
  });
};

export const removeMember = async (params: { ipaSession?: string | null; id: string; provider?: UserProvider; user?: string; group?: string }): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.removeMember({ id: params.id, user: params.user, group: params.group });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA groups", status: 401 };
  return providers.ipa.groups.removeMember({
    ipaSession: params.ipaSession,
    id: params.id,
    user: params.user,
    group: params.group,
  });
};

export const addManager = async (params: { ipaSession?: string | null; id: string; provider?: UserProvider; user?: string; group?: string }): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.addManager({ id: params.id, user: params.user, group: params.group });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA groups", status: 401 };
  return providers.ipa.groups.addManager({
    ipaSession: params.ipaSession,
    id: params.id,
    user: params.user,
    group: params.group,
  });
};

export const removeManager = async (params: { ipaSession?: string | null; id: string; provider?: UserProvider; user?: string; group?: string }): Promise<MutationResult<void>> => {
  const provider = params.provider ?? (await getGroup(params.id))?.provider;
  if (provider === "local") return localGroups.removeManager({ id: params.id, user: params.user, group: params.group });
  if (!params.ipaSession) return { ok: false, error: "IPA session required to update IPA groups", status: 401 };
  return providers.ipa.groups.removeManager({
    ipaSession: params.ipaSession,
    id: params.id,
    user: params.user,
    group: params.group,
  });
};
