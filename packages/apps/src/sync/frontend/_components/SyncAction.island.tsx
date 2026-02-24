import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/sync/client";
import { refreshCurrentPath } from "../lib/navigation";

export default function SyncAction() {
  const syncMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.index.$post({});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Sync failed.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleSync = async () => {
    const confirmed = await prompts.confirm("Run a full sync from FreeIPA? This may take a moment.", {
      title: "Force Sync",
      icon: "ti ti-refresh",
      confirmText: "Sync",
      cancelText: "Cancel",
    });
    if (confirmed) syncMutation.mutate();
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleSync} disabled={syncMutation.loading()}>
      <i class={syncMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
      {syncMutation.loading() ? "Syncing..." : "Force Sync"}
    </button>
  );
}
