import { workflowEvent } from "@valentinkolb/cloud/workflows";

export const MAIL_WORKFLOW_APP_ID = "mail";

export const MAIL_WORKFLOW_EVENT = {
  messageReceived: "mail.messageReceived",
  schedule: "mail.schedule",
} as const;

export const mailWorkflowEvents = {
  messageReceived: workflowEvent({
    label: "Message received",
    description: "A new inbound message was imported into the mailbox.",
    data: {
      kind: "object",
      properties: {
        message: { kind: "value", description: "Frozen Mail message value." },
        conversation: { kind: "value", description: "Frozen Mail conversation value." },
      },
    },
  }),
  schedule: workflowEvent({
    label: "Schedule fired",
    description: "A Mail workflow schedule reached its next slot.",
    data: {
      kind: "object",
      properties: {
        occurredAt: { kind: "string", description: "Scheduled occurrence timestamp." },
        slot: { kind: "string", description: "Stable scheduler slot timestamp." },
      },
    },
  }),
} as const;
