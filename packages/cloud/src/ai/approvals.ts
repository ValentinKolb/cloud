import { sql } from "bun";
import type { AiConversationResource, AiToolApprovalPolicy } from "./types";

export type AiToolApprovalContext = {
  actorUserId: string;
  appId: string;
  resource?: AiConversationResource;
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
