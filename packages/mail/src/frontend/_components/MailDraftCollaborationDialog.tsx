import { type DateContext, dates } from "@k2b/stdlib";
import { Avatar, Button, prompts } from "@k2b/ui";
import { Show } from "solid-js";
import type { DraftLease, DraftLeaseHolder } from "../../contracts";
import type { MailDraftLeaseConflict } from "./mail-draft-session";

export type MailDraftCollaborationChoice = "readonly" | "takeover";
export type MailDraftActorRef = Pick<DraftLeaseHolder, "kind" | "id">;

const isSameActor = (lease: DraftLease | null, currentActor: MailDraftActorRef): boolean =>
  lease?.holder.kind === currentActor.kind && lease.holder.id === currentActor.id;

const avatarSource = (lease: DraftLease | null): string | undefined =>
  lease?.holder.kind === "user" && lease.holder.avatarHash
    ? `/api/accounts/users/${encodeURIComponent(lease.holder.id)}/avatar?rev=${encodeURIComponent(lease.holder.avatarHash)}`
    : undefined;

export const mailDraftCollaborationCopy = (conflict: MailDraftLeaseConflict, currentActor: MailDraftActorRef) => {
  if (isSameActor(conflict.lease, currentActor)) {
    return {
      title: "Draft open in another tab",
      description:
        conflict.reason === "lost"
          ? "Another tab or window took over editing this draft. You can keep reading here or move editing back to this tab."
          : "You are already editing this draft in another tab or window. Only one tab can save changes at a time.",
      status: "You are editing this draft in another tab.",
      takeoverLabel: "Edit in this tab",
    };
  }
  if (conflict.lease) {
    const name = conflict.lease.holder.displayName.trim() || "Another collaborator";
    return {
      title: `${name} is editing this draft`,
      description: "You can read the draft now, or take over when you need to make changes. Taking over makes their editor read-only.",
      status: `${name} is currently editing this draft.`,
      takeoverLabel: "Take over",
    };
  }
  return {
    title: "Draft open elsewhere",
    description:
      "Another editing session currently controls this draft, but its details are unavailable. You can keep reading or try to edit here.",
    status: "This draft is currently being edited elsewhere.",
    takeoverLabel: "Try editing here",
  };
};

export function MailDraftCollaborationDialog(props: {
  conflict: MailDraftLeaseConflict;
  currentActor: MailDraftActorRef;
  dateConfig: DateContext;
  close: (choice: MailDraftCollaborationChoice) => void;
}) {
  const copy = () => mailDraftCollaborationCopy(props.conflict, props.currentActor);
  const lease = () => props.conflict.lease;

  return (
    <div class="flex min-w-0 flex-col gap-4">
      <p class="text-sm leading-6 text-secondary">{copy().description}</p>
      <Show when={lease()}>
        {(current) => (
          <div class="flex min-w-0 items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3">
            <Avatar name={current().holder.displayName} src={avatarSource(current())} size="sm" loading="eager" />
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-primary">{current().holder.displayName || "Another collaborator"}</p>
              <p class="text-xs leading-5 text-dimmed">
                Opened <time dateTime={current().acquiredAt}>{dates.formatDateTimeRelative(current().acquiredAt, props.dateConfig)}</time>
                {" · "}reserved until{" "}
                <time dateTime={current().expiresAt}>{dates.formatDateTime(current().expiresAt, props.dateConfig)}</time>
              </p>
            </div>
          </div>
        )}
      </Show>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" type="button" onClick={() => props.close("readonly")}>
          View read-only
        </Button>
        <Button type="button" onClick={() => props.close("takeover")}>
          {copy().takeoverLabel}
        </Button>
      </div>
    </div>
  );
}

export const openMailDraftCollaborationDialog = (options: {
  conflict: MailDraftLeaseConflict;
  currentActor: MailDraftActorRef;
  dateConfig: DateContext;
}): Promise<MailDraftCollaborationChoice | undefined> => {
  const copy = mailDraftCollaborationCopy(options.conflict, options.currentActor);
  return prompts.dialog<MailDraftCollaborationChoice>((close) => <MailDraftCollaborationDialog {...options} close={close} />, {
    title: copy.title,
    icon: "ti ti-users",
    size: "small",
  });
};
