import { sql } from "bun";
import type { IpaHost, IpaHostgroup } from "@valentinkolb/cloud-contracts/shared";
import { call, mapIpaErrorCode, type DbRow } from "./lib";

type MutationResult = { ok: true } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 500 };

// ==========================
// Hosts
// ==========================

/**
 * Lists hosts from the local mirror with optional search and pagination.
 */
export const hostList = async (params: {
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{ hosts: IpaHost[]; total: number }> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${params.search.toLowerCase()}%` : null;

  let countRows: DbRow[];
  let rows: DbRow[];

  if (search) {
    countRows = await sql`
      SELECT COUNT(*)::int as count FROM auth.hosts
      WHERE LOWER(fqdn) LIKE ${search} OR LOWER(description) LIKE ${search}`;
    rows = await sql`
      SELECT h.*,
        COALESCE(ARRAY(SELECT hostgroup_cn FROM auth.host_hostgroups WHERE host_fqdn = h.fqdn), '{}') AS hostgroups
      FROM auth.hosts h
      WHERE LOWER(h.fqdn) LIKE ${search} OR LOWER(h.description) LIKE ${search}
      ORDER BY h.fqdn
      LIMIT ${perPage} OFFSET ${offset}`;
  } else {
    countRows = await sql`SELECT COUNT(*)::int as count FROM auth.hosts`;
    rows = await sql`
      SELECT h.*,
        COALESCE(ARRAY(SELECT hostgroup_cn FROM auth.host_hostgroups WHERE host_fqdn = h.fqdn), '{}') AS hostgroups
      FROM auth.hosts h
      ORDER BY h.fqdn
      LIMIT ${perPage} OFFSET ${offset}`;
  }

  const total = (countRows[0]?.count as number) ?? 0;
  const hosts: IpaHost[] = rows.map((row) => ({
    fqdn: row.fqdn as string,
    description: row.description as string | null,
    location: row.location as string | null,
    locality: row.locality as string | null,
    memberofHostgroup: (row.hostgroups as string[]) ?? [],
    macAddress: (row.mac_address as string[]) ?? [],
    platform: (row.platform as string) ?? null,
    osVersion: (row.os_version as string) ?? null,
    sshFingerprints: (row.ssh_fingerprints as string[]) ?? [],
  }));

  return { hosts, total };
};

/**
 * Returns one mirrored host by FQDN from `auth.hosts` without an additional FreeIPA lookup.
 */
export const hostGet = async (fqdn: string): Promise<IpaHost | null> => {
  const rows: DbRow[] = await sql`
    SELECT h.*,
      COALESCE(ARRAY(SELECT hostgroup_cn FROM auth.host_hostgroups WHERE host_fqdn = h.fqdn), '{}') AS hostgroups
    FROM auth.hosts h WHERE h.fqdn = ${fqdn}`;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    fqdn: row.fqdn as string,
    description: row.description as string | null,
    location: row.location as string | null,
    locality: row.locality as string | null,
    memberofHostgroup: (row.hostgroups as string[]) ?? [],
    macAddress: (row.mac_address as string[]) ?? [],
    platform: (row.platform as string) ?? null,
    osVersion: (row.os_version as string) ?? null,
    sshFingerprints: (row.ssh_fingerprints as string[]) ?? [],
  };
};

/**
 * Updates one host in FreeIPA and mirrors the same fields back into the local table.
 */
export const hostMod = async (
  ipaSession: string,
  fqdn: string,
  opts: { location?: string; locality?: string; description?: string },
): Promise<MutationResult> => {
  const ipaOpts: Record<string, unknown> = {};
  if (opts.location !== undefined) ipaOpts.nshostlocation = opts.location;
  if (opts.locality !== undefined) ipaOpts.l = opts.locality;
  if (opts.description !== undefined) ipaOpts.description = opts.description;
  if (Object.keys(ipaOpts).length === 0) return { ok: true };

  const response = await call(ipaSession, "host_mod", [fqdn], ipaOpts);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    UPDATE auth.hosts SET
      description = ${opts.description ?? null},
      location = ${opts.location ?? null},
      locality = ${opts.locality ?? null}
    WHERE fqdn = ${fqdn}`;

  return { ok: true };
};

/**
 * Deletes one host in FreeIPA and removes it from the local mirror.
 */
export const hostDel = async (ipaSession: string, fqdn: string): Promise<MutationResult> => {
  const response = await call(ipaSession, "host_del", [fqdn], {});
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`DELETE FROM auth.hosts WHERE fqdn = ${fqdn}`;
  return { ok: true };
};

// ==========================
// Hostgroups
// ==========================

/**
 * Lists hostgroups from the local mirror with optional search and pagination.
 */
export const hostgroupList = async (params: {
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{ hostgroups: IpaHostgroup[]; total: number }> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${params.search.toLowerCase()}%` : null;

  let countRows: DbRow[];
  let rows: DbRow[];

  if (search) {
    countRows = await sql`
      SELECT COUNT(*)::int as count FROM auth.hostgroups
      WHERE LOWER(cn) LIKE ${search} OR LOWER(description) LIKE ${search}`;
    rows = await sql`
      SELECT hg.*,
        COALESCE(ARRAY(SELECT host_fqdn FROM auth.host_hostgroups WHERE hostgroup_cn = hg.cn), '{}') AS member_hosts,
        COALESCE(ARRAY(SELECT child_cn FROM auth.hostgroup_hostgroups WHERE parent_cn = hg.cn), '{}') AS member_hostgroups
      FROM auth.hostgroups hg
      WHERE LOWER(hg.cn) LIKE ${search} OR LOWER(hg.description) LIKE ${search}
      ORDER BY hg.cn
      LIMIT ${perPage} OFFSET ${offset}`;
  } else {
    countRows = await sql`SELECT COUNT(*)::int as count FROM auth.hostgroups`;
    rows = await sql`
      SELECT hg.*,
        COALESCE(ARRAY(SELECT host_fqdn FROM auth.host_hostgroups WHERE hostgroup_cn = hg.cn), '{}') AS member_hosts,
        COALESCE(ARRAY(SELECT child_cn FROM auth.hostgroup_hostgroups WHERE parent_cn = hg.cn), '{}') AS member_hostgroups
      FROM auth.hostgroups hg
      ORDER BY hg.cn
      LIMIT ${perPage} OFFSET ${offset}`;
  }

  const total = (countRows[0]?.count as number) ?? 0;
  const hostgroups: IpaHostgroup[] = rows.map((row) => ({
    cn: row.cn as string,
    description: row.description as string | null,
    hosts: (row.member_hosts as string[]) ?? [],
    hostgroups: (row.member_hostgroups as string[]) ?? [],
  }));

  return { hostgroups, total };
};

/**
 * Creates a hostgroup in FreeIPA and upserts it into the local mirror.
 */
export const hostgroupAdd = async (ipaSession: string, cn: string, opts?: { description?: string }): Promise<MutationResult> => {
  const ipaOpts: Record<string, unknown> = {};
  if (opts?.description) ipaOpts.description = opts.description;

  const response = await call(ipaSession, "hostgroup_add", [cn], ipaOpts);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    INSERT INTO auth.hostgroups (cn, description, synced_at)
    VALUES (${cn}, ${opts?.description ?? null}, now())
    ON CONFLICT (cn) DO UPDATE SET description = EXCLUDED.description, synced_at = now()`;

  return { ok: true };
};

/**
 * Updates hostgroup metadata in FreeIPA and mirrors the change locally.
 */
export const hostgroupMod = async (ipaSession: string, cn: string, opts: { description?: string }): Promise<MutationResult> => {
  const ipaOpts: Record<string, unknown> = {};
  if (opts.description !== undefined) ipaOpts.description = opts.description;
  if (Object.keys(ipaOpts).length === 0) return { ok: true };

  const response = await call(ipaSession, "hostgroup_mod", [cn], ipaOpts);
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    UPDATE auth.hostgroups SET
      description = ${opts.description ?? null},
      synced_at = now()
    WHERE cn = ${cn}`;

  return { ok: true };
};

/**
 * Deletes a hostgroup in FreeIPA and removes it from the local mirror.
 */
export const hostgroupDel = async (ipaSession: string, cn: string): Promise<MutationResult> => {
  const response = await call(ipaSession, "hostgroup_del", [cn], {});
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`DELETE FROM auth.hostgroups WHERE cn = ${cn}`;
  return { ok: true };
};

/**
 * Adds a host to a hostgroup in FreeIPA and records the relation locally.
 */
export const hostAddToGroup = async (ipaSession: string, fqdn: string, hostgroupCn: string): Promise<MutationResult> => {
  const response = await call(ipaSession, "hostgroup_add_member", [hostgroupCn], { host: fqdn });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`
    INSERT INTO auth.host_hostgroups (host_fqdn, hostgroup_cn)
    VALUES (${fqdn}, ${hostgroupCn})
    ON CONFLICT DO NOTHING`;

  return { ok: true };
};

/**
 * Removes a host from a hostgroup in FreeIPA and deletes the local relation.
 */
export const hostRemoveFromGroup = async (ipaSession: string, fqdn: string, hostgroupCn: string): Promise<MutationResult> => {
  const response = await call(ipaSession, "hostgroup_remove_member", [hostgroupCn], { host: fqdn });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message,
      status: mapIpaErrorCode(response.error.code),
    };
  }

  await sql`DELETE FROM auth.host_hostgroups WHERE host_fqdn = ${fqdn} AND hostgroup_cn = ${hostgroupCn}`;
  return { ok: true };
};

/**
 * Returns one mirrored hostgroup by CN including locally known host and child-group links.
 */
export const hostgroupGet = async (cn: string): Promise<IpaHostgroup | null> => {
  const rows: DbRow[] = await sql`
    SELECT hg.*,
      COALESCE(ARRAY(SELECT host_fqdn FROM auth.host_hostgroups WHERE hostgroup_cn = hg.cn), '{}') AS member_hosts,
      COALESCE(ARRAY(SELECT child_cn FROM auth.hostgroup_hostgroups WHERE parent_cn = hg.cn), '{}') AS member_hostgroups
    FROM auth.hostgroups hg WHERE hg.cn = ${cn}`;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    cn: row.cn as string,
    description: row.description as string | null,
    hosts: (row.member_hosts as string[]) ?? [],
    hostgroups: (row.member_hostgroups as string[]) ?? [],
  };
};

/**
 * List hosts belonging to a specific hostgroup with pagination.
 */
export const hostListByGroup = async (
  hostgroupCn: string,
  params: { search?: string; page?: number; perPage?: number },
): Promise<{ hosts: IpaHost[]; total: number }> => {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;
  const offset = (page - 1) * perPage;
  const search = params.search ? `%${params.search.toLowerCase()}%` : null;

  let countRows: DbRow[];
  let rows: DbRow[];

  if (search) {
    countRows = await sql`
      SELECT COUNT(*)::int as count FROM auth.hosts h
      JOIN auth.host_hostgroups hh ON h.fqdn = hh.host_fqdn
      WHERE hh.hostgroup_cn = ${hostgroupCn}
        AND (LOWER(h.fqdn) LIKE ${search} OR LOWER(h.description) LIKE ${search}
          OR LOWER(h.locality) LIKE ${search} OR LOWER(h.location) LIKE ${search})`;
    rows = await sql`
      SELECT h.*,
        COALESCE(ARRAY(SELECT hostgroup_cn FROM auth.host_hostgroups WHERE host_fqdn = h.fqdn), '{}') AS hostgroups
      FROM auth.hosts h
      JOIN auth.host_hostgroups hh ON h.fqdn = hh.host_fqdn
      WHERE hh.hostgroup_cn = ${hostgroupCn}
        AND (LOWER(h.fqdn) LIKE ${search} OR LOWER(h.description) LIKE ${search}
          OR LOWER(h.locality) LIKE ${search} OR LOWER(h.location) LIKE ${search})
      ORDER BY h.fqdn
      LIMIT ${perPage} OFFSET ${offset}`;
  } else {
    countRows = await sql`
      SELECT COUNT(*)::int as count FROM auth.host_hostgroups
      WHERE hostgroup_cn = ${hostgroupCn}`;
    rows = await sql`
      SELECT h.*,
        COALESCE(ARRAY(SELECT hostgroup_cn FROM auth.host_hostgroups WHERE host_fqdn = h.fqdn), '{}') AS hostgroups
      FROM auth.hosts h
      JOIN auth.host_hostgroups hh ON h.fqdn = hh.host_fqdn
      WHERE hh.hostgroup_cn = ${hostgroupCn}
      ORDER BY h.fqdn
      LIMIT ${perPage} OFFSET ${offset}`;
  }

  const total = (countRows[0]?.count as number) ?? 0;
  const hosts: IpaHost[] = rows.map((row) => ({
    fqdn: row.fqdn as string,
    description: row.description as string | null,
    location: row.location as string | null,
    locality: row.locality as string | null,
    memberofHostgroup: (row.hostgroups as string[]) ?? [],
    macAddress: (row.mac_address as string[]) ?? [],
    platform: (row.platform as string) ?? null,
    osVersion: (row.os_version as string) ?? null,
    sshFingerprints: (row.ssh_fingerprints as string[]) ?? [],
  }));

  return { hosts, total };
};
