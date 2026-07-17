import { type WorkflowFieldSchema, type WorkflowLanguageManifest, workflowBuiltinActionDescriptors } from "@valentinkolb/cloud/workflows";

const text = (description: string, optional = false, maxLength = 1_000): WorkflowFieldSchema => ({
  kind: "string",
  minLength: 1,
  maxLength,
  optional,
  description,
});

const object = (properties: Record<string, WorkflowFieldSchema>): WorkflowFieldSchema & { kind: "object" } => ({
  kind: "object",
  properties,
});

const referenceInput = () =>
  object({ required: { kind: "boolean", optional: true, description: "Whether callers must provide this input." } });

const messageReference = text("Message value reference.", false, 500);
const conversationReference = text("Conversation value reference.", false, 500);

export const mailWorkflowManifest: WorkflowLanguageManifest = {
  id: "mail",
  version: 1,
  limits: {
    maxInputs: 20,
    maxSteps: 500,
    maxDepth: 20,
    maxConditions: 500,
    maxConditionDepth: 20,
  },
  inputs: [
    {
      kind: "mailMessage",
      label: "Mail message",
      description: "One message in the workflow mailbox.",
      valueType: "mail.message",
      config: referenceInput(),
    },
    {
      kind: "mailConversation",
      label: "Mail conversation",
      description: "One conversation in the workflow mailbox.",
      valueType: "mail.conversation",
      config: referenceInput(),
    },
  ],
  triggers: [
    {
      kind: "messageReceived",
      label: "Message received",
      description: "Starts once for a stable newly imported message.",
      snippet: 'messageReceived:\n  with:\n    message: "${{ trigger.message }}"\n    conversation: "${{ trigger.conversation }}"',
      eventValues: {
        message: "mail.message",
        conversation: "mail.conversation",
        occurredAt: "core.dateTime",
      },
      config: object({}),
    },
    {
      kind: "schedule",
      label: "Schedule",
      description: "Starts the workflow for future cron slots in an IANA timezone.",
      snippet: 'schedule:\n  cron: "0 8 * * *"\n  timezone: Europe/Berlin\n  with: {}',
      eventValues: { occurredAt: "core.dateTime", slot: "core.dateTime" },
      config: object({
        cron: text("Five-field cron expression.", false, 120),
        timezone: text("IANA timezone. Defaults to UTC.", true, 80),
      }),
    },
  ],
  actions: [
    {
      kind: "addKeyword",
      label: "Add keyword",
      description: "Adds a portable provider keyword to a message through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference, keyword: text("Keyword or text expression.", false, 500) }),
    },
    {
      kind: "removeKeyword",
      label: "Remove keyword",
      description: "Removes a portable provider keyword from a message through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference, keyword: text("Keyword or text expression.", false, 500) }),
    },
    {
      kind: "moveMessage",
      label: "Move message",
      description: "Moves a message to an accessible folder through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference, folder: text("Accessible folder name, ID, or expression.", false, 500) }),
    },
    {
      kind: "assignConversation",
      label: "Assign conversation",
      description: "Assigns or unassigns a conversation after a current permission check.",
      effect: "transactional",
      dryRun: "full",
      config: object({
        conversation: conversationReference,
        user: { kind: "value", description: "Assignable user name, ID, expression, or null to unassign." },
      }),
    },
    {
      kind: "setConversationStatus",
      label: "Set conversation status",
      description: "Sets the collaboration status of a conversation after a current permission check.",
      effect: "transactional",
      dryRun: "full",
      config: object({
        conversation: conversationReference,
        status: { kind: "string", enum: ["open", "waiting", "done"], description: "New conversation status." },
      }),
    },
    {
      kind: "ensureConversationReference",
      label: "Ensure conversation reference",
      description: "Allocates one immutable mailbox-scoped reference when the conversation does not already have one for the scheme.",
      effect: "transactional",
      dryRun: "full",
      config: object({
        conversation: conversationReference,
        scheme: text("Enabled reference scheme name or ID. Uses the mailbox default when omitted.", true, 500),
      }),
    },
    {
      kind: "automaticReply",
      label: "Automatic reply",
      description: "Queues one guarded reply for an inbound message through the durable Mail outbox.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({
        message: messageReference,
        conversation: conversationReference,
        sender: text("Automation-enabled sender identity name or ID.", false, 500),
        subject: text("Reply subject or text expression.", false, 998),
        body: text("Reply body or text expression.", false, 2 * 1024 * 1024),
        format: { kind: "string", enum: ["plain", "markdown"], optional: true, description: "Reply body format." },
        schedule: text("Optional named response schedule.", true, 500),
        minimumIntervalHours: {
          kind: "number",
          integer: true,
          minimum: 0,
          maximum: 8_760,
          optional: true,
          description: "Minimum hours between automatic replies to the same recipient.",
        },
      }),
    },
    ...workflowBuiltinActionDescriptors,
  ],
};
