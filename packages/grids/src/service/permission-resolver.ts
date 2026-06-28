import { sql } from "bun";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const LEVEL_BY_RANK: PermissionLevel[] = ["none", "read", "write", "admin"];

export type ResourceType = "base" | "table" | "view" | "form" | "dashboard";

/**
 * Principal tier — captures HOW the loaded grant matched the user.
 * "user" means an explicit grant on this user's UUID; "group" means a
 * grant on a group the user belongs to; "authenticated" is the
 * "any signed-in user" sentinel; "public" is "anyone, anonymous
 * included". Tier specificity decreases left-to-right; a deny at a
 * MORE-specific tier shadows allow at a less-specific tier.
 */
export type PrincipalTier = "user" | "group" | "authenticated" | "public";

export type Grant = {
  resourceType: ResourceType;
  resourceId: string;
  principalTier: PrincipalTier;
  level: PermissionLevel;
};

export type ResolveTarget =
  | { baseId: string }
  | { baseId: string; tableId: string }
  | { baseId: string; tableId: string; viewId: string }
  | { baseId: string; tableId: string; formId: string }
  | { baseId: string; dashboardId: string };

const PRINCIPAL_TIERS: PrincipalTier[] = ["user", "group", "authenticated", "public"];

/**
 * Resolves a single resource's effective level by walking principal
 * tiers from most specific (user) to least (public). Within a tier,
 * `none` is deny-overrides — any deny in the tier returns 'none' for
 * that tier. Otherwise the highest non-deny rank wins. Returns null
 * when the resource has zero grants visible to this user (caller
 * falls back to a less-specific resource scope, or to the
 * resource-default visibility).
 *
 * This mirrors the SQL `bool_or(permission='none')` shape used by
 * views.listForTable and dashboards.listForBase, so the central
 * resolver and the visibility-list queries cannot drift apart.
 */
const resolveResourceLevel = (grants: Grant[]): PermissionLevel | null => {
  for (const tier of PRINCIPAL_TIERS) {
    const tierGrants = grants.filter((g) => g.principalTier === tier);
    if (tierGrants.length === 0) continue;
    if (tierGrants.some((g) => g.level === "none")) return "none";
    let max = 0;
    for (const g of tierGrants) {
      if (LEVEL_RANK[g.level] > max) max = LEVEL_RANK[g.level];
    }
    return LEVEL_BY_RANK[max]!;
  }
  return null;
};

/**
 * Most-specific-RESOURCE-wins: walk dashboard / view / form / table /
 * base and return the first scope that has any grants visible to the
 * user. Within that scope, principal-tier deny-overrides apply (see
 * resolveResourceLevel). When no resource scope has grants, returns
 * 'none' — the API layer optionally falls back to "default-shared"
 * visibility for personal-vs-shared resources (handled in the listing
 * queries directly).
 *
 * Note on dashboards: this resolver returns whatever level the grants
 * resolve to. The API gate decides what that level allows for a
 * dashboard — by product rule (locked Wave 2 decision), dashboard
 * write requires `admin`; the resolver doesn't know about that
 * collapse.
 */
export const resolveEffectivePermission = (grants: Grant[], target: ResolveTarget): PermissionLevel => {
  const tryScope = (resourceType: ResourceType, resourceId: string): PermissionLevel | null => {
    const scoped = grants.filter((g) => g.resourceType === resourceType && g.resourceId === resourceId);
    return scoped.length > 0 ? resolveResourceLevel(scoped) : null;
  };

  if ("dashboardId" in target) {
    const lvl = tryScope("dashboard", target.dashboardId);
    if (lvl !== null) return lvl;
  }
  if ("formId" in target) {
    const lvl = tryScope("form", target.formId);
    if (lvl !== null) return lvl;
  }
  if ("viewId" in target) {
    const lvl = tryScope("view", target.viewId);
    if (lvl !== null) return lvl;
  }
  if ("tableId" in target) {
    const lvl = tryScope("table", target.tableId);
    if (lvl !== null) return lvl;
  }
  const baseLvl = tryScope("base", target.baseId);
  return baseLvl ?? "none";
};

/** Compares two levels via the rank order. */
export const hasAtLeast = (level: PermissionLevel, required: PermissionLevel): boolean => LEVEL_RANK[level] >= LEVEL_RANK[required];

/**
 * Returns true when `grants` has any entry for the (resourceType,
 * resourceId) pair. Lets API direct-GET handlers distinguish "explicit
 * grant on this resource" from "inherited from parent" — useful for
 * personal-resource visibility (a personal view is visible to a
 * non-owner only via an explicit view-level grant; inherited table
 * access is not enough).
 */
export const hasGrantsForResource = (grants: Grant[], resourceType: ResourceType, resourceId: string): boolean =>
  grants.some((g) => g.resourceType === resourceType && g.resourceId === resourceId);

// ──────────────────────────────────────────────────────────────────
// DB-fetching half
// ──────────────────────────────────────────────────────────────────

type DbRow = Record<string, unknown>;

/**
 * Loads all grants reachable for this user across base / table / view /
 * form / dashboard ACLs for the given target chain. One query, five UNION
 * ALL legs — keeps permission lookup to a single round-trip.
 *
 * Each row carries a principal_tier label derived from the auth.access
 * row's shape: explicit user_id ⇒ user, explicit group_id ⇒ group,
 * authenticated_only=TRUE ⇒ authenticated, all-null ⇒ public. The
 * resolver walks tiers from most-specific to least.
 */
export const loadGrantsForUser = async (params: {
  userId: string | null;
  userGroups: string[];
  baseId: string;
  tableId?: string | null;
  viewId?: string | null;
  formId?: string | null;
  dashboardId?: string | null;
}): Promise<Grant[]> => {
  const userId = params.userId;
  // Use the shared helper — it tolerates non-array inputs (bun.sql surfaces
  // empty uuid[] columns as "{}" string, and the admin user has no groups).
  const groups = toPgUuidArray(params.userGroups);
  const tableId = params.tableId ?? null;
  const viewId = params.viewId ?? null;
  const formId = params.formId ?? null;
  const dashboardId = params.dashboardId ?? null;

  // CASE expression that classifies each auth.access row into one of
  // the four principal tiers. Mirrors the WHERE-clause filter so the
  // tier label corresponds to the matching condition. Same SQL fragment
  // is reused per resource leg.
  const tierExpr = sql`CASE
    WHEN a.user_id IS NOT NULL THEN 'user'
    WHEN a.group_id IS NOT NULL THEN 'group'
    WHEN a.authenticated_only = TRUE THEN 'authenticated'
    ELSE 'public'
  END`;

  const principalMatch = sql`(
    a.user_id = ${userId}::uuid
    OR a.group_id = ANY(${groups}::uuid[])
    OR (a.authenticated_only = TRUE AND ${userId}::uuid IS NOT NULL)
    OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = FALSE)
  )`;

  const rows = await sql<DbRow[]>`
    SELECT 'base'::text AS resource_type, ba.base_id::text AS resource_id, a.permission AS level, ${tierExpr} AS principal_tier
    FROM grids.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${params.baseId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'table'::text, ta.table_id::text, a.permission, ${tierExpr}
    FROM grids.table_access ta
    JOIN auth.access a ON a.id = ta.access_id
    WHERE ta.table_id = ${tableId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'view'::text, va.view_id::text, a.permission, ${tierExpr}
    FROM grids.view_access va
    JOIN auth.access a ON a.id = va.access_id
    WHERE va.view_id = ${viewId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'form'::text, fa.form_id::text, a.permission, ${tierExpr}
    FROM grids.form_access fa
    JOIN auth.access a ON a.id = fa.access_id
    WHERE fa.form_id = ${formId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'dashboard'::text, da.dashboard_id::text, a.permission, ${tierExpr}
    FROM grids.dashboard_access da
    JOIN auth.access a ON a.id = da.access_id
    WHERE da.dashboard_id = ${dashboardId}::uuid AND ${principalMatch}
  `;

  return rows.map((row) => ({
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id as string,
    principalTier: row.principal_tier as PrincipalTier,
    level: row.level as PermissionLevel,
  }));
};
