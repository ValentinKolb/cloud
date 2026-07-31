import { logger, trace } from "@valentinkolb/cloud/services";
import { listWorkflowRuns } from "@valentinkolb/cloud/workflows/store";
import { err, fail, ok, type Result } from "@k2b/stdlib";
import type { Mailbox, MailWorkflow, SenderIdentity } from "../contracts";
import { type MailWorkflowCatalogSnapshot, snapshotMailWorkflowCatalog } from "../workflows/catalog";
import * as access from "./access";
import type { MailRequestContext } from "./auth";
import { requireAutomaticReplyManagementPermission } from "./automatic-reply-access";
import type { AutomaticReplyConfiguration } from "./automatic-reply-configuration";
import * as automaticReplies from "./automatic-reply-configuration";
import {
  type MailAutomationActivityItem,
  projectMailBackfillActivity,
  projectMailWorkflowActivity,
  summarizeMailAutomationActivity,
} from "./automation-activity";
import type { ConversationReferenceConfiguration } from "./conversation-reference";
import * as conversationReferences from "./conversation-reference";
import type { MailRule } from "./mail-rules";
import * as mailRules from "./mail-rules";
import * as mailboxes from "./mailboxes";
import * as senderIdentities from "./sender-identities";
import { loadMailWorkflowCatalog } from "./workflow-catalog-service";
import * as workflows from "./workflows";

const log = logger("mail:automation-workspace");

export type MailAutomationAccessData = {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
};

export type MailAutomationOverviewData = MailAutomationAccessData & {
  canManageAutomaticReplies: boolean;
  automaticReplies: AutomaticReplyConfiguration[];
  mailRules: MailRule[] | null;
  customWorkflows: MailWorkflow[] | null;
  recentActivity: MailAutomationActivityItem[] | null;
};

export type MailAutomaticRepliesWorkspaceData = MailAutomationAccessData & {
  canManageAutomaticReplies: boolean;
  identities: SenderIdentity[];
  automaticReplies: AutomaticReplyConfiguration[];
  referenceConfiguration: ConversationReferenceConfiguration | null;
};

export type MailRulesWorkspaceData = MailAutomationAccessData & {
  mailRules: MailRule[];
  catalog: MailWorkflowCatalogSnapshot;
};

export type MailWorkflowsWorkspaceData = MailAutomationAccessData & {
  workflows: MailWorkflow[];
  referenceConfiguration: ConversationReferenceConfiguration | null;
};

export type {
  MailAutomationActivityItem,
  MailAutomationActivityKind,
  MailAutomationActivityStatus,
} from "./automation-activity";

export type MailAutomationActivityData = MailAutomationAccessData & {
  items: MailAutomationActivityItem[];
  counts: {
    total: number;
    active: number;
    failed: number;
    backfills: number;
  };
};

const loadAccess = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailAutomationAccessData>> => {
  const permission = await access.getMailboxPermission(context, mailboxId);
  if (permission === "none") return fail(err.forbidden("Access denied"));
  const mailboxResult = await mailboxes.getMailbox(context, mailboxId);
  if (!mailboxResult.ok) return fail(mailboxResult.error);
  return ok({ mailbox: mailboxResult.data, permission });
};

const loadAdminAccess = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailAutomationAccessData>> => {
  const result = await loadAccess(context, mailboxId);
  if (!result.ok) return result;
  return result.data.permission === "admin" ? result : fail(err.forbidden("Mailbox administration permission required"));
};

const customWorkflows = (definitions: MailWorkflow[], replies: AutomaticReplyConfiguration[], rules: MailRule[]): MailWorkflow[] => {
  const managedIds = new Set([...replies.map((item) => item.workflowId), ...rules.map((item) => item.workflowId)]);
  return definitions.filter((workflow) => !managedIds.has(workflow.id));
};

const loadActivityItems = async (
  mailboxId: string,
  replies: AutomaticReplyConfiguration[],
  rules: MailRule[],
  limit = 200,
): Promise<MailAutomationActivityItem[]> => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const [runs, backfills] = await Promise.all([
    listWorkflowRuns({ appId: "mail", scopeId: mailboxId, since, limit }),
    trace.list(
      { page: 1, perPage: limit, offset: 0 },
      {
        filter: {
          appId: "mail",
          source: "mail:mail-rule-backfill",
          category: "backfill",
          window: "30d",
          attributeEquals: { "mail.mailbox.id": mailboxId },
        },
      },
    ),
  ]);
  const replyWorkflowIds = new Set(replies.map((configuration) => configuration.workflowId));
  const mailRuleWorkflowIds = new Set(rules.map((rule) => rule.workflowId));
  const ruleNames = new Map(rules.map((rule) => [rule.id, rule.name]));
  const workflowNames = new Map([
    ...replies.map((configuration) => [configuration.workflowId, configuration.name] as const),
    ...rules.map((rule) => [rule.workflowId, rule.name] as const),
  ]);
  return [
    ...runs.map((run) => projectMailWorkflowActivity({ mailboxId, run, replyWorkflowIds, mailRuleWorkflowIds, workflowNames })),
    ...backfills.spans.map((span) => projectMailBackfillActivity({ mailboxId, span, ruleNames })),
  ]
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);
};

export const loadMailAutomationOverview = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailAutomationOverviewData>> => {
  const accessResult = await loadAccess(context, mailboxId);
  if (!accessResult.ok) return accessResult;
  const [replyResult, managementPermission] = await Promise.all([
    automaticReplies.listAutomaticReplyConfigurations(context, mailboxId),
    requireAutomaticReplyManagementPermission(context, mailboxId),
  ]);
  if (!replyResult.ok) return fail(replyResult.error);

  if (accessResult.data.permission !== "admin") {
    return ok({
      ...accessResult.data,
      canManageAutomaticReplies: managementPermission.ok,
      automaticReplies: replyResult.data,
      mailRules: null,
      customWorkflows: null,
      recentActivity: null,
    });
  }

  const [ruleResult, workflowResult] = await Promise.all([
    mailRules.listMailRules(context, mailboxId),
    workflows.listWorkflows(context, mailboxId),
  ]);
  if (!ruleResult.ok) return fail(ruleResult.error);
  if (!workflowResult.ok) return fail(workflowResult.error);
  const recentActivity = await loadActivityItems(mailboxId, replyResult.data, ruleResult.data, 8).catch((error) => {
    log.warn("Failed to load recent Mail automation activity", {
      mailboxId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  return ok({
    ...accessResult.data,
    canManageAutomaticReplies: true,
    automaticReplies: replyResult.data,
    mailRules: ruleResult.data,
    customWorkflows: customWorkflows(workflowResult.data, replyResult.data, ruleResult.data),
    recentActivity,
  });
};

export const loadMailAutomaticRepliesWorkspace = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailAutomaticRepliesWorkspaceData>> => {
  const accessResult = await loadAccess(context, mailboxId);
  if (!accessResult.ok) return accessResult;
  const [identityResult, replyResult, referenceResult, managementPermission] = await Promise.all([
    senderIdentities.listSenderIdentities(context, mailboxId),
    automaticReplies.listAutomaticReplyConfigurations(context, mailboxId),
    conversationReferences.getConversationReferenceConfiguration(context, mailboxId),
    requireAutomaticReplyManagementPermission(context, mailboxId),
  ]);
  if (!identityResult.ok) return fail(identityResult.error);
  if (!replyResult.ok) return fail(replyResult.error);
  if (!referenceResult.ok) return fail(referenceResult.error);
  return ok({
    ...accessResult.data,
    canManageAutomaticReplies: managementPermission.ok,
    identities: identityResult.data,
    automaticReplies: replyResult.data,
    referenceConfiguration: referenceResult.data,
  });
};

export const loadMailRulesWorkspace = async (context: MailRequestContext, mailboxId: string): Promise<Result<MailRulesWorkspaceData>> => {
  const accessResult = await loadAdminAccess(context, mailboxId);
  if (!accessResult.ok) return accessResult;
  const [ruleResult, catalog] = await Promise.all([
    mailRules.listMailRules(context, mailboxId),
    loadMailWorkflowCatalog({ context, mailboxId }),
  ]);
  if (!ruleResult.ok) return fail(ruleResult.error);
  return ok({
    ...accessResult.data,
    mailRules: ruleResult.data,
    catalog: snapshotMailWorkflowCatalog(catalog),
  });
};

export const loadMailWorkflowsWorkspace = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailWorkflowsWorkspaceData>> => {
  const accessResult = await loadAdminAccess(context, mailboxId);
  if (!accessResult.ok) return accessResult;
  const [workflowResult, replyResult, ruleResult, referenceResult] = await Promise.all([
    workflows.listWorkflows(context, mailboxId),
    automaticReplies.listAutomaticReplyConfigurations(context, mailboxId),
    mailRules.listMailRules(context, mailboxId),
    conversationReferences.getConversationReferenceConfiguration(context, mailboxId),
  ]);
  if (!workflowResult.ok) return fail(workflowResult.error);
  if (!replyResult.ok) return fail(replyResult.error);
  if (!ruleResult.ok) return fail(ruleResult.error);
  if (!referenceResult.ok) return fail(referenceResult.error);
  return ok({
    ...accessResult.data,
    workflows: customWorkflows(workflowResult.data, replyResult.data, ruleResult.data),
    referenceConfiguration: referenceResult.data,
  });
};

export const loadMailAutomationActivity = async (
  context: MailRequestContext,
  mailboxId: string,
): Promise<Result<MailAutomationActivityData>> => {
  const accessResult = await loadAdminAccess(context, mailboxId);
  if (!accessResult.ok) return accessResult;
  const [replyResult, ruleResult] = await Promise.all([
    automaticReplies.listAutomaticReplyConfigurations(context, mailboxId),
    mailRules.listMailRules(context, mailboxId),
  ]);
  if (!replyResult.ok) return fail(replyResult.error);
  if (!ruleResult.ok) return fail(ruleResult.error);
  let items: MailAutomationActivityItem[];
  try {
    items = await loadActivityItems(mailboxId, replyResult.data, ruleResult.data);
  } catch (error) {
    log.error("Failed to load Mail automation activity", {
      mailboxId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(err.internal("Failed to load automation activity"));
  }
  return ok({
    ...accessResult.data,
    items,
    counts: summarizeMailAutomationActivity(items),
  });
};
