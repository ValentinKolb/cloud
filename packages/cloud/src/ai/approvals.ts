import { sql } from "bun";
import type { AiConversationResource, AiToolApprovalPolicy } from "./types";

export type AiToolApprovalContext = {
  actorUserId: string;
  appId: string;
  resource?: AiConversationResource;
};

export type AiToolApprovalPreference = {
  id: string;
  contextAppId: string;
  resource: Exclude<AiConversationResource, { kind: "direct" }> | null;
  toolName: string;
  approvalScope: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

type AiToolApprovalPreferenceRow = {
  id: string;
  app_id: string;
  resource_app_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  tool_name: string;
  approval_scope: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
};

type ApprovalResourceColumns = {
  resourceAppId: string | null;
  resourceType: string | null;
  resourceId: string | null;
};

const approvalResourceColumns = (resource: AiConversationResource | undefined): ApprovalResourceColumns => {
  if (!resource || resource.kind === "direct") return { resourceAppId: null, resourceType: null, resourceId: null };
  return { resourceAppId: resource.appId, resourceType: resource.resourceType, resourceId: resource.resourceId };
};

export const aiToolApprovalScope = (toolName: string, policy: AiToolApprovalPolicy | undefined): string => {
  if (policy && typeof policy === "object") return policy.scope ?? toolName;
  return toolName;
};

export const aiToolNeedsApproval = (policy: AiToolApprovalPolicy | undefined): boolean => policy !== "never";

export const aiToolAllowsAlways = (policy: AiToolApprovalPolicy | undefined): boolean =>
  policy === "always" || (typeof policy === "object" && policy.kind === "user-configurable");

export const hasRememberedAiToolApproval = async (
  context: AiToolApprovalContext,
  input: { toolName: string; approvalScope: string },
): Promise<boolean> => {
  const resource = approvalResourceColumns(context.resource);
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM ai.tool_approval_preferences
    WHERE actor_user_id = ${context.actorUserId}
      AND app_id = ${context.appId}
      AND resource_app_id IS NOT DISTINCT FROM ${resource.resourceAppId}
      AND resource_type IS NOT DISTINCT FROM ${resource.resourceType}
      AND resource_id IS NOT DISTINCT FROM ${resource.resourceId}
      AND tool_name = ${input.toolName}
      AND approval_scope = ${input.approvalScope}
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `;

  const id = rows[0]?.id;
  if (!id) return false;
  await sql`UPDATE ai.tool_approval_preferences SET last_used_at = now() WHERE id = ${id}`;
  return true;
};

export const rememberAiToolApproval = async (
  context: AiToolApprovalContext,
  input: { toolName: string; approvalScope: string; expiresAt?: Date | null },
): Promise<void> => {
  const resource = approvalResourceColumns(context.resource);
  await sql.begin(async () => {
    await sql`
      DELETE FROM ai.tool_approval_preferences
      WHERE actor_user_id = ${context.actorUserId}
        AND app_id = ${context.appId}
        AND resource_app_id IS NOT DISTINCT FROM ${resource.resourceAppId}
        AND resource_type IS NOT DISTINCT FROM ${resource.resourceType}
        AND resource_id IS NOT DISTINCT FROM ${resource.resourceId}
        AND tool_name = ${input.toolName}
        AND approval_scope = ${input.approvalScope}
    `;

    await sql`
      INSERT INTO ai.tool_approval_preferences (
        actor_user_id,
        app_id,
        resource_app_id,
        resource_type,
        resource_id,
        tool_name,
        approval_scope,
        last_used_at,
        expires_at
      )
      VALUES (
        ${context.actorUserId},
        ${context.appId},
        ${resource.resourceAppId},
        ${resource.resourceType},
        ${resource.resourceId},
        ${input.toolName},
        ${input.approvalScope},
        now(),
        ${input.expiresAt ?? null}
      )
    `;
  });
};

export const forgetAiToolApproval = async (
  context: AiToolApprovalContext,
  input: { toolName: string; approvalScope: string },
): Promise<void> => {
  const resource = approvalResourceColumns(context.resource);
  await sql`
    DELETE FROM ai.tool_approval_preferences
    WHERE actor_user_id = ${context.actorUserId}
      AND app_id = ${context.appId}
      AND resource_app_id IS NOT DISTINCT FROM ${resource.resourceAppId}
      AND resource_type IS NOT DISTINCT FROM ${resource.resourceType}
      AND resource_id IS NOT DISTINCT FROM ${resource.resourceId}
      AND tool_name = ${input.toolName}
      AND approval_scope = ${input.approvalScope}
  `;
};

const toIsoString = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

const approvalPreferenceFromRow = (row: AiToolApprovalPreferenceRow): AiToolApprovalPreference => ({
  id: row.id,
  contextAppId: row.app_id,
  resource:
    row.resource_app_id && row.resource_type && row.resource_id
      ? {
          kind: "resource",
          appId: row.resource_app_id,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
        }
      : null,
  toolName: row.tool_name,
  approvalScope: row.approval_scope,
  createdAt: toIsoString(row.created_at),
  lastUsedAt: row.last_used_at ? toIsoString(row.last_used_at) : null,
  expiresAt: row.expires_at ? toIsoString(row.expires_at) : null,
});

export const listAiToolApprovalPreferences = async (actorUserId: string): Promise<AiToolApprovalPreference[]> => {
  const rows = await sql<AiToolApprovalPreferenceRow[]>`
    SELECT
      id,
      app_id,
      resource_app_id,
      resource_type,
      resource_id,
      tool_name,
      approval_scope,
      created_at,
      last_used_at,
      expires_at
    FROM ai.tool_approval_preferences
    WHERE actor_user_id = ${actorUserId}
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY last_used_at DESC NULLS LAST, created_at DESC, id
  `;
  return rows.map(approvalPreferenceFromRow);
};

export const revokeAiToolApprovalPreference = async (actorUserId: string, preferenceId: string): Promise<boolean> => {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM ai.tool_approval_preferences
    WHERE id = ${preferenceId}
      AND actor_user_id = ${actorUserId}
    RETURNING id
  `;
  return rows.length > 0;
};
