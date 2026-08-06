import type { MailAiAutomationDefinition, MailAiAutomationKind, MailAiAutomationScope, MailRuleAction } from "../../contracts";
import type { MailAiAutomation } from "../../service/ai-automations";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";

export const mailAiAutomationKindMeta: Record<MailAiAutomationKind, { label: string; description: string; icon: string }> = {
  route: {
    label: "Route with AI",
    description: "Choose exactly one category, then run its folder or collaboration actions.",
    icon: "ti ti-route-alt-left",
  },
  tag: {
    label: "Add tags with AI",
    description: "Select every relevant local tag without moving or sending mail.",
    icon: "ti ti-tags",
  },
  draft: {
    label: "Draft replies with AI",
    description: "Create a reviewable reply draft in the conversation without sending it.",
    icon: "ti ti-pencil-bolt",
  },
};

export const initialMailAiAutomationDefinition = (
  kind: MailAiAutomationKind,
  catalog: MailWorkflowCatalogSnapshot,
): MailAiAutomationDefinition => {
  if (kind === "route") {
    return {
      kind,
      prompt: "Choose the category that best describes the incoming message.",
      categories: [
        {
          name: "Needs attention",
          description: "Messages that require a person to act.",
          actions: [{ kind: "set_status", status: "needs_action" }],
        },
        {
          name: "Other",
          description: "Messages that do not match another category.",
          actions: [{ kind: "set_status", status: "done" }],
        },
      ],
    };
  }
  if (kind === "tag") {
    const tags = (catalog.localTags ?? []).slice(0, 2);
    return {
      kind,
      prompt: "Select every local tag that clearly applies to the incoming message.",
      tags: tags.map((tag) => ({ tagId: tag.id, description: `Use for ${tag.name}.` })),
      maxTags: Math.min(2, tags.length),
    };
  }
  return {
    kind,
    senderIdentityId: catalog.senderIdentities?.[0]?.id ?? "",
    instructions: "Write a concise, helpful response and ask for any information required to continue.",
    maxOutputChars: 4_000,
  };
};

export const nextMailAiAutomationName = (kind: MailAiAutomationKind, automations: readonly Pick<MailAiAutomation, "name">[]): string => {
  const base = mailAiAutomationKindMeta[kind].label;
  const names = new Set(automations.map((automation) => automation.name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix <= automations.length + 1; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${automations.length + 2}`;
};

const actionCatalogIssue = (action: MailRuleAction, catalog: MailWorkflowCatalogSnapshot): string | null => {
  if (action.kind === "move_to_folder" && !catalog.folders.some((folder) => folder.id === action.folderId)) {
    return "Choose an available destination folder.";
  }
  if (action.kind === "add_local_tag" && !(catalog.localTags ?? []).some((tag) => tag.id === action.tagId)) {
    return "Choose an available local tag.";
  }
  if (action.kind === "assign_user" && !catalog.assignableUsers.some((user) => user.id === action.userId)) {
    return "Choose an available assignee.";
  }
  return null;
};

export const mailAiAutomationCatalogIssue = (
  definition: MailAiAutomationDefinition,
  catalog: MailWorkflowCatalogSnapshot,
): string | null => {
  if (definition.kind === "tag") {
    return definition.tags.some((selected) => !(catalog.localTags ?? []).some((tag) => tag.id === selected.tagId))
      ? "Replace unavailable local tags before saving."
      : null;
  }
  if (definition.kind === "draft") {
    return (catalog.senderIdentities ?? []).some((identity) => identity.id === definition.senderIdentityId)
      ? null
      : "Choose a verified sender identity that permits mailbox automation.";
  }
  for (const category of definition.categories) {
    for (const action of category.actions) {
      const issue = actionCatalogIssue(action, catalog);
      if (issue) return `${category.name || "Routing category"}: ${issue}`;
    }
  }
  return null;
};

export const mailAiAutomationScopeLabel = (scope: MailAiAutomationScope): string =>
  scope.mode === "all"
    ? "All incoming mail"
    : `${scope.conditions.mode === "all" ? "All" : "Any"} of ${scope.conditions.items.length} conditions`;

export const mailAiAutomationResultLabel = (definition: MailAiAutomationDefinition, catalog: MailWorkflowCatalogSnapshot): string => {
  if (definition.kind === "route") return `${definition.categories.length} routes`;
  if (definition.kind === "tag") {
    const names = new Map((catalog.localTags ?? []).map((tag) => [tag.id, tag.name]));
    return definition.tags.map((tag) => names.get(tag.tagId) ?? "Unavailable tag").join(" · ");
  }
  return "Reply draft in conversation";
};

export const sortMailAiAutomations = <T extends Pick<MailAiAutomation, "enabled" | "name">>(automations: readonly T[]): T[] =>
  [...automations].sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name));
