import type { MailDraft } from "../../contracts";

export type ClosedMailDraft = MailDraft & { state: Exclude<MailDraft["state"], "draft"> };

export type MailDraftLifecycleTransition = {
  draft: ClosedMailDraft;
  hasUnsavedChanges: boolean;
};

export const isClosedMailDraft = (draft: MailDraft): draft is ClosedMailDraft => draft.state !== "draft";

export const reconcileMailDraftLifecycle = (
  current: MailDraftLifecycleTransition | null,
  draft: MailDraft,
  hasUnsavedChanges: boolean,
): MailDraftLifecycleTransition | null =>
  isClosedMailDraft(draft)
    ? {
        draft,
        hasUnsavedChanges: current?.hasUnsavedChanges ?? hasUnsavedChanges,
      }
    : current;

export const mailDraftLifecycleMessage = (draft: ClosedMailDraft): string => {
  if (draft.state === "scheduled") return `This message was scheduled by ${draft.lastEditedByDisplayName}.`;
  if (draft.state === "sending") return `${draft.lastEditedByDisplayName} started sending this message.`;
  if (draft.state === "sent") return `This message was sent by ${draft.lastEditedByDisplayName}.`;
  return `This draft was discarded by ${draft.lastEditedByDisplayName}.`;
};

export const mailDraftLifecycleTitle = (state: ClosedMailDraft["state"]): string =>
  state === "scheduled"
    ? "Message scheduled"
    : state === "sending"
      ? "Message is being sent"
      : state === "sent"
        ? "Message sent"
        : "Draft discarded";
