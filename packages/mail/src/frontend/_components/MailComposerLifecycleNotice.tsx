import { Button, NoticeCard } from "@k2b/ui";
import { onMount, Show } from "solid-js";
import type { MailDraftLifecycleTransition } from "./mail-draft-lifecycle";
import { mailDraftLifecycleMessage, mailDraftLifecycleTitle } from "./mail-draft-lifecycle";

export default function MailComposerLifecycleNotice(props: {
  transition: MailDraftLifecycleTransition;
  savingCopy: boolean;
  onCopyText: () => void;
  onSaveAsNew: () => void;
  onOpenMessage: () => void;
}) {
  const draft = () => props.transition.draft;
  let notice: HTMLDivElement | undefined;
  onMount(() => notice?.focus({ preventScroll: true }));
  return (
    <div ref={notice} role="group" tabIndex={-1} aria-label={mailDraftLifecycleTitle(draft().state)}>
      <NoticeCard
        tone={props.transition.hasUnsavedChanges ? "warning" : "info"}
        icon={draft().state === "discarded" ? "ti ti-trash" : "ti ti-send"}
        title={mailDraftLifecycleTitle(draft().state)}
        class="mx-3 mt-3"
      >
        <div class="flex flex-col gap-3">
          <div class="space-y-1" role="status" aria-live="polite">
            <p>{mailDraftLifecycleMessage(draft())}</p>
            <Show when={props.transition.hasUnsavedChanges}>
              <p class="font-medium">Your unsaved draft content is still shown below and was not included.</p>
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={props.transition.hasUnsavedChanges}>
              <Button size="sm" variant="secondary" type="button" onClick={props.onCopyText}>
                <i class="ti ti-copy" aria-hidden="true" /> Copy text
              </Button>
              <Button size="sm" variant="primary" type="button" loading={props.savingCopy} onClick={props.onSaveAsNew}>
                <i class="ti ti-file-plus" aria-hidden="true" /> Save as new draft
              </Button>
            </Show>
            <Show when={draft().conversationId}>
              <Button size="sm" variant="secondary" type="button" onClick={props.onOpenMessage}>
                <i class="ti ti-external-link" aria-hidden="true" /> Open message
              </Button>
            </Show>
          </div>
        </div>
      </NoticeCard>
    </div>
  );
}
