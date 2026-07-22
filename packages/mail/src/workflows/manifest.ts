import { type WorkflowFieldSchema, type WorkflowLanguageManifest, workflowBuiltinActionDescriptors } from "@valentinkolb/cloud/workflows";

const text = (description: string, optional = false, maxLength = 1_000): WorkflowFieldSchema => ({
  kind: "string",
  minLength: 1,
  maxLength,
  optional,
  description,
});
const identifier = (description: string): WorkflowFieldSchema => ({
  kind: "string",
  format: "identifier",
  maxLength: 120,
  optional: true,
  description,
});
const requiredIdentifier = (description: string): WorkflowFieldSchema => ({
  kind: "string",
  format: "identifier",
  maxLength: 120,
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
const scheduleWindow = object({
  start: text("Inclusive local start time in HH:mm format.", false, 5),
  end: text("Exclusive local end time in HH:mm format; 24:00 is allowed.", false, 5),
});
const responseSchedule = object({
  timeZone: text("IANA timezone used to evaluate dates and local hours.", false, 80),
  activeRanges: {
    kind: "array",
    maxItems: 32,
    items: object({
      from: text("Inclusive start date in YYYY-MM-DD format.", false, 10),
      to: { kind: "value", description: "Inclusive end date in YYYY-MM-DD format, or null for no end." },
    }),
  },
  weeklyWindows: {
    kind: "array",
    maxItems: 64,
    items: object({
      weekday: { kind: "number", integer: true, minimum: 1, maximum: 7, description: "ISO weekday from 1 (Monday) to 7 (Sunday)." },
      ...scheduleWindow.properties,
    }),
  },
  exceptions: {
    kind: "array",
    maxItems: 366,
    items: object({
      date: text("Exception date in YYYY-MM-DD format.", false, 10),
      closed: { kind: "boolean", description: "Whether the schedule is inactive for the whole date." },
      windows: { kind: "array", maxItems: 32, items: scheduleWindow },
    }),
  },
});

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
      kind: "copyMessage",
      label: "Copy message",
      description: "Copies a message to an accessible folder through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference, folder: text("Accessible folder name or ID.", false, 500) }),
    },
    {
      kind: "archiveMessage",
      label: "Archive message",
      description: "Moves a message to the mailbox archive folder through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference }),
    },
    {
      kind: "trashMessage",
      label: "Trash message",
      description: "Moves a message to the mailbox trash folder through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({ message: messageReference }),
    },
    {
      kind: "addFlag",
      label: "Add flag",
      description: "Adds a standard message flag through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({
        message: messageReference,
        flag: { kind: "string", enum: ["seen", "answered", "flagged", "draft"], description: "Standard message flag." },
      }),
    },
    {
      kind: "removeFlag",
      label: "Remove flag",
      description: "Removes a standard message flag through the durable command journal.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({
        message: messageReference,
        flag: { kind: "string", enum: ["seen", "answered", "flagged", "draft"], description: "Standard message flag." },
      }),
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
        status: { kind: "string", enum: ["needs_action", "waiting", "done"], description: "New conversation status." },
      }),
    },
    {
      kind: "ensureConversationReference",
      label: "Ensure conversation reference",
      description: "Allocates the immutable mailbox-scoped reference when the conversation does not already have one.",
      effect: "transactional",
      dryRun: "full",
      outputType: "mail.reference",
      config: object({
        conversation: conversationReference,
        result: identifier("Optional variable name for the allocated reference result."),
      }),
    },
    {
      kind: "addLocalTag",
      label: "Add local tag",
      description: "Adds a mailbox-local tag to a conversation transactionally.",
      effect: "transactional",
      dryRun: "full",
      config: object({
        conversation: conversationReference,
        tag: text("Mailbox-local tag name or ID.", false, 500),
      }),
    },
    {
      kind: "removeLocalTag",
      label: "Remove local tag",
      description: "Removes a mailbox-local tag from a conversation transactionally.",
      effect: "transactional",
      dryRun: "full",
      config: object({
        conversation: conversationReference,
        tag: text("Mailbox-local tag name or ID.", false, 500),
      }),
    },
    {
      kind: "addComment",
      label: "Add internal comment",
      description: "Adds an internal conversation comment transactionally.",
      effect: "transactional",
      dryRun: "full",
      config: object({ conversation: conversationReference, body: text("Internal comment body or text expression.", false, 50_000) }),
    },
    {
      kind: "createDraft",
      label: "Create draft",
      description: "Creates a normal-delivery workflow draft without sending it.",
      effect: "transactional",
      dryRun: "full",
      outputType: "mail.draft",
      config: object({
        sender: text("Automation-enabled sender identity name or ID.", false, 500),
        to: { kind: "value", description: "Recipient address array or expression." },
        cc: { kind: "value", optional: true, description: "CC address array or expression." },
        bcc: { kind: "value", optional: true, description: "BCC address array or expression." },
        subject: text("Draft subject or text expression.", false, 998),
        body: text("Draft body or text expression.", false, 2 * 1024 * 1024),
        format: { kind: "string", enum: ["plain", "markdown"], optional: true, description: "Draft body format." },
        result: requiredIdentifier("Variable name for the created draft."),
      }),
    },
    {
      kind: "scheduleDraftSend",
      label: "Schedule draft send",
      description: "Schedules a normal-delivery workflow draft through the durable Mail outbox.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({
        draft: text("Draft value reference.", false, 500),
        scheduledAt: text("ISO timestamp or date-time expression.", false, 100),
      }),
    },
    {
      kind: "notifyUser",
      label: "Notify user",
      description: "Sends an internal notification to a current mailbox reader.",
      effect: "durable-intent",
      dryRun: "validate",
      config: object({
        user: text("Current mailbox reader name or ID.", false, 500),
        title: text("Notification title or text expression.", false, 160),
        body: text("Notification body or text expression.", false, 2_000),
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
        schedule: { ...responseSchedule, optional: true, description: "Optional inline response window for this action." },
        inactiveBehavior: {
          kind: "string",
          enum: ["skip", "defer"],
          optional: true,
          description: "Skip outside the response schedule or defer until its next active window.",
        },
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
