import { prompts, toast, Button } from "@k2b/ui";
import { type DateContext, dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";
import { messageDeliveryControlLabel, undoSendSecondsRemaining } from "./mail-message-presentation";

type MessageDelivery = NonNullable<MessageDetail["delivery"]>;

export default function MailMessageDeliveryControl(props: {
  mailboxId: string;
  delivery: MessageDelivery;
  canWrite: boolean;
  dateConfig: DateContext;
  onReconcile: () => Promise<void>;
}) {
  const [now, setNow] = createSignal(Date.now());
  let expiryTimer: number | undefined;
  let reconciledSubmissionId: string | null = null;
  let scheduledDialogOpen = false;
  let closeScheduledDialog: (() => void) | null = null;

  const clearExpiryTimer = () => {
    if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    expiryTimer = undefined;
  };
  const remainingSeconds = createMemo(() => undoSendSecondsRemaining(props.delivery.undoUntil, now()));
  const visible = createMemo(() => {
    if (!messageDeliveryControlLabel(props.delivery.state, props.canWrite)) return false;
    return props.delivery.state !== "undo_window" || remainingSeconds() !== 0;
  });
  const label = createMemo(() => {
    const action = messageDeliveryControlLabel(props.delivery.state, props.canWrite);
    const remaining = remainingSeconds();
    return action && props.delivery.state === "undo_window" && remaining !== null ? `${action} · ${remaining}s` : action;
  });

  const reconcileAfterExpiry = () => {
    if (reconciledSubmissionId === props.delivery.submissionId) return;
    reconciledSubmissionId = props.delivery.submissionId;
    void props.onReconcile().catch(() => undefined);
  };

  createEffect(() => {
    clearExpiryTimer();
    const submissionId = props.delivery.submissionId;
    const undoUntil = props.delivery.state === "undo_window" ? props.delivery.undoUntil : null;
    if (reconciledSubmissionId !== submissionId) reconciledSubmissionId = null;
    if (!undoUntil || typeof window === "undefined") return;
    const deadline = Date.parse(undoUntil);
    if (!Number.isFinite(deadline)) return;

    const tick = () => {
      const current = Date.now();
      setNow(current);
      const remainingMilliseconds = deadline - current;
      if (remainingMilliseconds <= 0) {
        clearExpiryTimer();
        reconcileAfterExpiry();
        return;
      }
      const nextSecond = remainingMilliseconds % 1000 || 1000;
      expiryTimer = window.setTimeout(tick, Math.min(remainingMilliseconds, nextSecond + 20));
    };
    tick();
  });

  const cancel = mutations.create<void, { submissionId: string }, { reconcile: () => Promise<void>; state: MessageDelivery["state"] }>({
    onBefore: () => ({ reconcile: props.onReconcile, state: props.delivery.state }),
    mutation: async ({ submissionId }, { abortSignal }) => {
      const route = apiClient.mailboxes[":mailboxId"]["scheduled-sends"][":scheduledSendId"];
      const response = await route.cancel.$post(
        {
          param: { mailboxId: props.mailboxId, scheduledSendId: submissionId },
          json: { disposition: "draft" },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not undo this send"));
    },
    onSuccess: (_result, context) => {
      toast.success(context?.state === "scheduled" ? "Scheduled send cancelled. The message was restored as a draft." : "Send undone.");
      if (context)
        void context.reconcile().catch(() => toast.error("The message changed, but this conversation could not be refreshed yet."));
    },
    onError: (error) => toast.error(error.message),
  });

  const openScheduledDetails = async () => {
    if (scheduledDialogOpen) return;
    scheduledDialogOpen = true;
    const submissionId = props.delivery.submissionId;
    const scheduledAt = props.delivery.scheduledAt;
    const dateConfig = props.dateConfig;
    try {
      await prompts.dialog<void>(
        (close) => {
          closeScheduledDialog = () => close();
          const cancelScheduledSend = async () => {
            await cancel.mutate({ submissionId });
            if (!cancel.error()) close();
          };

          return (
            <div class="flex flex-col gap-4">
              <div class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2">
                <p class="text-xs font-medium text-dimmed">Scheduled delivery</p>
                <p class="mt-1 text-sm font-semibold text-primary">{dates.formatDateTime(scheduledAt, dateConfig)}</p>
                <p class="mt-1 text-xs text-dimmed">Time zone: {dateConfig.timeZone}</p>
              </div>
              <p class="text-sm text-secondary">
                Cancel delivery to return this message to Drafts. You can edit it there or schedule it again.
              </p>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" size="sm" type="button" disabled={cancel.loading()} onClick={() => close()}>
                  Keep scheduled
                </Button>
                <Button variant="danger" size="sm" type="button" disabled={cancel.loading()} onClick={() => void cancelScheduledSend()}>
                  <i class={`ti ${cancel.loading() ? "ti-loader-2 animate-spin" : "ti-calendar-cancel"}`} aria-hidden="true" />
                  Cancel send
                </Button>
              </div>
            </div>
          );
        },
        { title: "Scheduled message", icon: "ti ti-calendar-time" },
      );
    } finally {
      scheduledDialogOpen = false;
      closeScheduledDialog = null;
    }
  };

  onCleanup(() => {
    clearExpiryTimer();
    closeScheduledDialog?.();
    closeScheduledDialog = null;
    cancel.abort();
  });

  return (
    <Show when={visible() && label()}>
      {(actionLabel) => (
        <div class="flex flex-wrap items-center gap-2 px-3 pb-1">
          <button
            type="button"
            class="mail-delivery-action-badge focus-ui transition-colors disabled:cursor-wait disabled:opacity-60"
            data-mail-undo-send={props.delivery.state === "undo_window" ? "" : undefined}
            data-mail-scheduled-send={props.delivery.state === "scheduled" ? "" : undefined}
            disabled={cancel.loading()}
            aria-label={
              props.delivery.state === "undo_window" && remainingSeconds() !== null
                ? `Undo send, ${remainingSeconds()} seconds remaining`
                : "View scheduled delivery details"
            }
            title={
              props.delivery.state === "undo_window"
                ? "Cancel delivery and restore this message as a draft"
                : `Scheduled for ${dates.formatDateTime(props.delivery.scheduledAt, props.dateConfig)}`
            }
            onClick={() =>
              props.delivery.state === "scheduled"
                ? void openScheduledDetails()
                : void cancel.mutate({ submissionId: props.delivery.submissionId })
            }
          >
            <i
              class={`ti ${
                cancel.loading() ? "ti-loader-2 animate-spin" : props.delivery.state === "scheduled" ? "ti-clock" : "ti-arrow-back-up"
              }`}
              aria-hidden="true"
            />
            <span>{actionLabel()}</span>
          </button>
        </div>
      )}
    </Show>
  );
}
