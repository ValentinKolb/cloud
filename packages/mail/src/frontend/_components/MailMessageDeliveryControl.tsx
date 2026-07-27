import { toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
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
  onReconcile: () => Promise<void>;
}) {
  const [now, setNow] = createSignal(Date.now());
  let expiryTimer: number | undefined;
  let reconciledSubmissionId: string | null = null;

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

  const cancel = mutations.create<void, { submissionId: string }, { reconcile: () => Promise<void> }>({
    onBefore: () => ({ reconcile: props.onReconcile }),
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
      toast.success(
        props.delivery.state === "scheduled" ? "Scheduled send cancelled. The message was restored as a draft." : "Send undone.",
      );
      if (context)
        void context.reconcile().catch(() => toast.error("The message changed, but this conversation could not be refreshed yet."));
    },
    onError: (error) => toast.error(error.message),
  });

  onCleanup(() => {
    clearExpiryTimer();
    cancel.abort();
  });

  return (
    <Show when={visible() && label()}>
      {(actionLabel) => (
        <div class="flex flex-wrap items-center gap-2 pb-1 pl-14 pr-3">
          <button
            type="button"
            class={
              props.delivery.state === "undo_window"
                ? "k2b-status-badge focus-ui cursor-pointer transition-colors hover:bg-[var(--ui-hover)] disabled:cursor-wait disabled:opacity-60"
                : "btn-secondary btn-sm"
            }
            data-tone="neutral"
            data-mail-undo-send={props.delivery.state === "undo_window" ? "" : undefined}
            disabled={cancel.loading()}
            aria-label={
              props.delivery.state === "undo_window" && remainingSeconds() !== null
                ? `Undo send, ${remainingSeconds()} seconds remaining`
                : actionLabel()
            }
            title={props.delivery.state === "undo_window" ? "Cancel delivery and restore this message as a draft" : undefined}
            onClick={() => cancel.mutate({ submissionId: props.delivery.submissionId })}
          >
            <i class={`ti ${cancel.loading() ? "ti-loader-2 animate-spin" : "ti-arrow-back-up"}`} aria-hidden="true" />
            <span>{actionLabel()}</span>
          </button>
        </div>
      )}
    </Show>
  );
}
