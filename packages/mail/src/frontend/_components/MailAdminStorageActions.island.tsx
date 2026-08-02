import { prompts, toast, Button } from "@k2b/ui";
import { mutation } from "@k2b/stdlib/solid";
import { onCleanup } from "solid-js";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";

export default function MailAdminStorageActions() {
  const reconcile = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.admin.storage.reconcile.$post(undefined, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readApiError(response, "Could not reconcile Mail storage"));
    },
    onSuccess: () => {
      toast.success("Storage reconciliation queued");
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => reconcile.abort());

  return (
    <Button variant="secondary" size="sm" type="button" disabled={reconcile.loading()} onClick={() => reconcile.mutate()}>
      <i class={`ti ${reconcile.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
      Refresh storage snapshot
    </Button>
  );
}
