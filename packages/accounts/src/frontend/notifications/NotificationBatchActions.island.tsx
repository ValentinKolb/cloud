import { createSignal, Show } from "solid-js";
import { Checkbox, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

type SelectionPayload = {
  mode?: "specific" | "rules";
  rules?: ("account_manager" | "local" | "ipa" | "guest" | "user")[];
  all?: boolean;
  userIds?: string[];
  groupIds?: string[];
  includeGroupMembers?: boolean;
  accountManagers?: {
    mode?: "none" | "all" | "groups";
    groupIds?: string[];
    recursive?: boolean;
  };
  providers?: ("local" | "ipa")[];
  profiles?: ("user" | "guest")[];
};

type Props = {
  batchId: string;
  status: string;
  selection: SelectionPayload;
  selectionHash: string;
  errorCount: number;
};

type RecipientPreview = {
  deliverableCount: number;
  skippedNoEmailCount: number;
  recipientHash: string;
};

const formatCount = new Intl.NumberFormat("en");

const readError = async (res: Response, fallback: string) => {
  try {
    const data = await res.json();
    return data.message ?? data.error?.message ?? fallback;
  } catch {
    return fallback;
  }
};

function FinalizeDialog(props: {
  deliverableCount: number;
  skippedNoEmailCount: number;
  onConfirm: () => Promise<void>;
  close: () => void;
}) {
  const [confirmed, setConfirmed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const confirm = async () => {
    if (!confirmed()) return;
    setLoading(true);
    try {
      await props.onConfirm();
      props.close();
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="info-block-warning flex min-w-0 items-start gap-2 text-sm">
        <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
        <span class="min-w-0 break-words">
          This will send the email to {formatCount.format(props.deliverableCount)} recipients. {formatCount.format(props.skippedNoEmailCount)} selected
          accounts have no email address and will be skipped.
        </span>
      </div>
      <Checkbox
        label="I confirmed the recipient count and message."
        value={confirmed}
        onChange={setConfirmed}
        description="Finalizing snapshots the recipients and starts the async delivery job."
      />
      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={loading()}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={confirm} disabled={!confirmed() || loading()}>
          <i class={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-send"} />
          <span>{loading() ? "Starting..." : "Finalize and send"}</span>
        </button>
      </div>
    </div>
  );
}

export default function NotificationBatchActions(props: Props) {
  const [loadingAction, setLoadingAction] = createSignal<"finalize" | "delete" | "retry" | null>(null);
  const isLoading = () => loadingAction() !== null;

  const finalize = async () => {
    setLoadingAction("finalize");
    try {
      const previewRes = await apiClient.notifications.batches.preview.$post({ json: { selection: props.selection } });
      if (!previewRes.ok) throw new Error(await readError(previewRes, "Failed to preview recipients."));
      const preview = (await previewRes.json()) as RecipientPreview;
      if (preview.deliverableCount === 0) {
        prompts.error("No deliverable recipients match this batch.");
        return;
      }
      await prompts.dialog<void>(
        (close) => (
          <FinalizeDialog
            deliverableCount={preview.deliverableCount}
            skippedNoEmailCount={preview.skippedNoEmailCount}
            close={close}
            onConfirm={async () => {
              const res = await apiClient.notifications.batches[":id"].finalize.$post({
                param: { id: props.batchId },
                json: {
                  expectedSelectionHash: props.selectionHash,
                  expectedDeliverableCount: preview.deliverableCount,
                  expectedRecipientHash: preview.recipientHash,
                },
              });
              if (!res.ok) throw new Error(await readError(res, "Failed to finalize batch."));
              refreshCurrentPath();
            }}
          />
        ),
        { title: "Finalize Notification Batch", icon: "ti ti-send" },
      );
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  const retryFailed = async () => {
    setLoadingAction("retry");
    try {
      const res = await apiClient.notifications.batches[":id"]["retry-failed"].$post({ param: { id: props.batchId } });
      if (!res.ok) throw new Error(await readError(res, "Failed to retry recipients."));
      refreshCurrentPath();
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  const deleteDraft = async () => {
    const confirmed = await prompts.confirm("Delete this notification draft? It has not been sent yet and cannot be restored.", {
      title: "Delete draft",
      confirmText: "Delete draft",
      variant: "danger",
    });
    if (!confirmed) return;

    setLoadingAction("delete");
    try {
      const res = await apiClient.notifications.batches[":id"].$delete({ param: { id: props.batchId } });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete draft."));
      navigateTo("/app/accounts/notifications");
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div class="flex flex-wrap justify-end gap-2">
      <Show when={props.status === "draft"}>
        <button type="button" class="btn-input btn-input-sm text-red-600 hover:text-red-700 dark:text-red-300" onClick={deleteDraft} disabled={isLoading()}>
          <i class={loadingAction() === "delete" ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
          <span>Delete draft</span>
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={finalize} disabled={isLoading()}>
          <i class={loadingAction() === "finalize" ? "ti ti-loader-2 animate-spin" : "ti ti-send"} />
          <span>{loadingAction() === "finalize" ? "Checking..." : "Finalize"}</span>
        </button>
      </Show>
      <Show when={props.errorCount > 0 && props.status !== "draft"}>
        <button type="button" class="btn-input btn-input-sm" onClick={retryFailed} disabled={isLoading()}>
          <i class={loadingAction() === "retry" ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
          <span>Retry failed</span>
        </button>
      </Show>
    </div>
  );
}
