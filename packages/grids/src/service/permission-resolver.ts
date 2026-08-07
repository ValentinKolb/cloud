import { type AccessSubject, buildAccessPrincipalCondition, type PermissionLevel } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import type { RecordScope } from "../contracts";
import { ALL_RECORD_ACCESS, type AuthorizedRecordAccess } from "./record-access";

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const LEVEL_BY_RANK: PermissionLevel[] = ["none", "read", "write", "admin"];

export type ResourceType = "base" | "table" | "view" | "form" | "documentTemplate" | "customApp" | "workflow";

/**
 * Principal tier — captures HOW the loaded grant matched the user.
 * "serviceAccount" and "user" mean explicit grants on the actor itself;
 * "group" means a grant on a group the user belongs to; "authenticated"
 * is the "any signed-in user" sentinel; "public" is "anyone, anonymous
 * included". Tier specificity decreases left-to-right; a deny at a
 * MORE-specific tier shadows allow at a less-specific tier.
 */
type PrincipalTier = "serviceAccount" | "user" | "group" | "authenticated" | "public";

export type Grant = {
  resourceType: ResourceType;
  resourceId: string;
  principalTier: PrincipalTier;
  level: PermissionLevel;
  /** Missing only for pre-migration/in-memory callers; persisted grants always provide it. */
  recordScope?: RecordScope;
};

export type ResolveTarget =
  | { baseId: string }
  | { baseId: string; tableId: string }
  | { baseId: string; tableId: string; viewId: string }
  | { baseId: string; tableId: string; formId: string }
  | { baseId: string; tableId: string; documentTemplateId: string }
  | { baseId: string; customAppId: string }
  | { baseId: string; workflowId: string };

const PRINCIPAL_TIERS: PrincipalTier[] = ["serviceAccount", "user", "group", "authenticated", "public"];

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
 * views and Custom Apps use the same grant resolution, so the central
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

type ResourceDecision = { level: PermissionLevel; grants: Grant[] };

const resolveResourceDecision = (grants: Grant[]): ResourceDecision | null => {
  for (const tier of PRINCIPAL_TIERS) {
    const tierGrants = grants.filter((grant) => grant.principalTier === tier);
    if (tierGrants.length === 0) continue;
    if (tierGrants.some((grant) => grant.level === "none")) return { level: "none", grants: [] };
    const level = resolveResourceLevel(tierGrants) ?? "none";
    return { level, grants: tierGrants };
  }
  return null;
};

const targetScopes = (target: ResolveTarget): Array<[ResourceType, string]> => [
  ...("customAppId" in target ? [["customApp", target.customAppId] as [ResourceType, string]] : []),
  ...("workflowId" in target ? [["workflow", target.workflowId] as [ResourceType, string]] : []),
  ...("documentTemplateId" in target ? [["documentTemplate", target.documentTemplateId] as [ResourceType, string]] : []),
  ...("formId" in target ? [["form", target.formId] as [ResourceType, string]] : []),
  ...("viewId" in target ? [["view", target.viewId] as [ResourceType, string]] : []),
  ...("tableId" in target ? [["table", target.tableId] as [ResourceType, string]] : []),
  ["base", target.baseId],
];

export const resolvePermissionDecision = (grants: Grant[], target: ResolveTarget): ResourceDecision => {
  for (const [resourceType, resourceId] of targetScopes(target)) {
    const scoped = grants.filter((grant) => grant.resourceType === resourceType && grant.resourceId === resourceId);
    const decision = resolveResourceDecision(scoped);
    if (decision) return decision;
  }
  return { level: "none", grants: [] };
};

export const resolveAuthorizedRecordAccess = (
  grants: Grant[],
  target: ResolveTarget,
  required: PermissionLevel,
  userId: string | null,
): { level: PermissionLevel; recordAccess: AuthorizedRecordAccess | null } => {
  const decision = resolvePermissionDecision(grants, target);
  if (!hasAtLeast(decision.level, required)) return { level: decision.level, recordAccess: null };
  const qualifying = decision.grants.filter((grant) => hasAtLeast(grant.level, required));
  if (qualifying.some((grant) => (grant.recordScope ?? { kind: "all" }).kind === "all")) {
    return { level: decision.level, recordAccess: ALL_RECORD_ACCESS };
  }
  if (!userId) return { level: decision.level, recordAccess: null };
  const scopes = [
    ...new Map(
      qualifying
        .flatMap((grant) => {
          const scope = grant.recordScope ?? { kind: "all" as const };
          return scope.kind === "all" ? [] : [scope];
        })
        .map((scope) => [scope.kind === "created_by" ? scope.kind : `${scope.kind}:${scope.relationFieldId}`, scope] as const),
    ).values(),
  ].sort((left, right) => {
    const leftKey = left.kind === "created_by" ? left.kind : `${left.kind}:${left.relationFieldId}`;
    const rightKey = right.kind === "created_by" ? right.kind : `${right.kind}:${right.relationFieldId}`;
    return leftKey.localeCompare(rightKey);
  });
  return scopes.length > 0
    ? { level: decision.level, recordAccess: { kind: "restricted", userId, scopes } }
    : { level: decision.level, recordAccess: null };
};

/**
 * Most-specific-RESOURCE-wins: walk custom app / view / form / table /
 * base and return the first scope that has any grants visible to the
 * user. Within that scope, principal-tier deny-overrides apply (see
 * resolveResourceLevel). When no resource scope has grants, returns
 * 'none' — the API layer optionally falls back to "default-shared"
 * visibility for personal-vs-shared resources (handled in the listing
 * queries directly).
 *
 */
export const resolveEffectivePermission = (grants: Grant[], target: ResolveTarget): PermissionLevel => {
  return resolvePermissionDecision(grants, target).level;
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
 * Loads all grants reachable for this user across the registered resource
 * scopes for the given target chain. One UNION query keeps permission lookup
 * to a single round-trip.
 *
 * Each row carries a principal_tier label derived from the auth.access
 * row's shape: explicit user_id ⇒ user, explicit group_id ⇒ group,
 * authenticated_only=TRUE ⇒ authenticated, all-null ⇒ public. The
 * resolver walks tiers from most-specific to least.
 */
type LoadGrantTargets = {
  baseId: string;
  tableId?: string | null;
  viewId?: string | null;
  formId?: string | null;
  documentTemplateId?: string | null;
  customAppId?: string | null;
  workflowId?: string | null;
};

export const loadGrantsForSubject = async (
  params: LoadGrantTargets & { subject: AccessSubject | null },
  db: typeof sql = sql,
): Promise<Grant[]> => {
  const tableId = params.tableId ?? null;
  const viewId = params.viewId ?? null;
  const formId = params.formId ?? null;
  const documentTemplateId = params.documentTemplateId ?? null;
  const customAppId = params.customAppId ?? null;
  const workflowId = params.workflowId ?? null;

  // CASE expression that classifies each auth.access row into one of
  // the four principal tiers. Mirrors the WHERE-clause filter so the
  // tier label corresponds to the matching condition. Same SQL fragment
  // is reused per resource leg.
  const tierExpr = sql`CASE
    WHEN a.service_account_id IS NOT NULL THEN 'serviceAccount'
    WHEN a.user_id IS NOT NULL THEN 'user'
    WHEN a.group_id IS NOT NULL THEN 'group'
    WHEN a.authenticated_only = TRUE THEN 'authenticated'
    ELSE 'public'
  END`;

  const principalMatch = buildAccessPrincipalCondition({
    subject: params.subject,
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });

  const rows = await db<DbRow[]>`
    SELECT 'base'::text AS resource_type, ba.base_id::text AS resource_id, a.permission AS level, ${tierExpr} AS principal_tier, ba.record_scope
    FROM grids.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${params.baseId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'table'::text, ta.table_id::text, a.permission, ${tierExpr}, ta.record_scope
    FROM grids.table_access ta
    JOIN auth.access a ON a.id = ta.access_id
    WHERE ta.table_id = ${tableId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'view'::text, va.view_id::text, a.permission, ${tierExpr}, va.record_scope
    FROM grids.view_access va
    JOIN auth.access a ON a.id = va.access_id
    WHERE va.view_id = ${viewId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'form'::text, fa.form_id::text, a.permission, ${tierExpr}, '{"kind":"all"}'::jsonb
    FROM grids.form_access fa
    JOIN auth.access a ON a.id = fa.access_id
    WHERE fa.form_id = ${formId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'documentTemplate'::text, dta.template_id::text, a.permission, ${tierExpr}, '{"kind":"all"}'::jsonb
    FROM grids.document_template_access dta
    JOIN auth.access a ON a.id = dta.access_id
    WHERE dta.template_id = ${documentTemplateId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'customApp'::text, caa.custom_app_id::text, a.permission, ${tierExpr}, '{"kind":"all"}'::jsonb
    FROM grids.custom_app_access caa
    JOIN auth.access a ON a.id = caa.access_id
    WHERE caa.custom_app_id = ${customAppId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'workflow'::text, wa.workflow_id::text, a.permission, ${tierExpr}, '{"kind":"all"}'::jsonb
    FROM grids.workflow_access wa
    JOIN auth.access a ON a.id = wa.access_id
    WHERE wa.workflow_id = ${workflowId}::uuid AND ${principalMatch}
  `;

  return rows.map((row) => ({
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id as string,
    principalTier: row.principal_tier as PrincipalTier,
    level: row.level as PermissionLevel,
    recordScope: (row.record_scope ?? { kind: "all" }) as RecordScope,
  }));
};

/**
 * Loads the base, table, and view grants needed to authorize a complete query
 * catalog. GQL uses this instead of issuing one grant query per resource.
 */
export const loadBaseTableGrantsForSubject = async (
  params: { baseId: string; subject: AccessSubject | null },
  db: typeof sql = sql,
): Promise<Grant[]> => {
  const tierExpr = sql`CASE
    WHEN a.service_account_id IS NOT NULL THEN 'serviceAccount'
    WHEN a.user_id IS NOT NULL THEN 'user'
    WHEN a.group_id IS NOT NULL THEN 'group'
    WHEN a.authenticated_only = TRUE THEN 'authenticated'
    ELSE 'public'
  END`;
  const principalMatch = buildAccessPrincipalCondition({
    subject: params.subject,
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });

  const rows = await db<DbRow[]>`
    SELECT 'base'::text AS resource_type, ba.base_id::text AS resource_id, a.permission AS level, ${tierExpr} AS principal_tier, ba.record_scope
    FROM grids.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${params.baseId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'table'::text, ta.table_id::text, a.permission, ${tierExpr}, ta.record_scope
    FROM grids.table_access ta
    JOIN grids.tables t ON t.id = ta.table_id
    JOIN auth.access a ON a.id = ta.access_id
    WHERE t.base_id = ${params.baseId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'view'::text, va.view_id::text, a.permission, ${tierExpr}, va.record_scope
    FROM grids.view_access va
    JOIN grids.views v ON v.id = va.view_id
    JOIN grids.tables t ON t.id = v.table_id
    JOIN auth.access a ON a.id = va.access_id
    WHERE t.base_id = ${params.baseId}::uuid AND ${principalMatch}
  `;

  return rows.map((row) => ({
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id as string,
    principalTier: row.principal_tier as PrincipalTier,
    level: row.level as PermissionLevel,
    recordScope: (row.record_scope ?? { kind: "all" }) as RecordScope,
  }));
};

export const loadBaseWorkflowGrantsForSubject = async (
  params: { baseId: string; subject: AccessSubject | null },
  db: typeof sql = sql,
): Promise<Grant[]> => {
  const tierExpr = sql`CASE
    WHEN a.service_account_id IS NOT NULL THEN 'serviceAccount'
    WHEN a.user_id IS NOT NULL THEN 'user'
    WHEN a.group_id IS NOT NULL THEN 'group'
    WHEN a.authenticated_only = TRUE THEN 'authenticated'
    ELSE 'public'
  END`;
  const principalMatch = buildAccessPrincipalCondition({
    subject: params.subject,
    columns: {
      userId: sql`a.user_id`,
      groupId: sql`a.group_id`,
      serviceAccountId: sql`a.service_account_id`,
      authenticatedOnly: sql`a.authenticated_only`,
    },
  });

  const rows = await db<DbRow[]>`
    SELECT 'base'::text AS resource_type, ba.base_id::text AS resource_id, a.permission AS level, ${tierExpr} AS principal_tier, ba.record_scope
    FROM grids.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${params.baseId}::uuid AND ${principalMatch}

    UNION ALL

    SELECT 'workflow'::text, wa.workflow_id::text, a.permission, ${tierExpr}, '{"kind":"all"}'::jsonb
    FROM grids.workflow_access wa
    JOIN grids.workflow_profile w ON w.id = wa.workflow_id
    JOIN auth.access a ON a.id = wa.access_id
    WHERE w.base_id = ${params.baseId}::uuid AND ${principalMatch}
  `;

  return rows.map((row) => ({
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id as string,
    principalTier: row.principal_tier as PrincipalTier,
    level: row.level as PermissionLevel,
    recordScope: (row.record_scope ?? { kind: "all" }) as RecordScope,
  }));
};

/**
 * Compatibility adapter for existing Grids callers. Caller-provided group ids
 * are deliberately ignored; nested membership is resolved by Cloud from the
 * authoritative auth graph on every query.
 */
export const loadGrantsForUser = async (
  params: LoadGrantTargets & {
    userId: string | null;
    userGroups?: string[];
    serviceAccountId?: string | null;
  },
  db: typeof sql = sql,
): Promise<Grant[]> =>
  loadGrantsForSubject(
    {
      ...params,
      subject: params.userId
        ? { type: "user", userId: params.userId }
        : params.serviceAccountId
          ? { type: "service_account", serviceAccountId: params.serviceAccountId }
          : null,
    },
    db,
  );
