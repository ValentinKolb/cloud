import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { navigateTo } from "@valentinkolb/ssr/nav";

const SyncHosts = () => {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const response = await apiClient.sync.$post();
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "Failed to start host sync.");
      }
    },
    onSuccess: async () => {
      const showLogs = await prompts.confirm(
        "Host sync started. FreeIPA remains the source of truth. The local mirror updates when the sync job finishes. Open the sync logs now?",
        {
          title: "Sync started",
          icon: "ti ti-refresh",
          confirmText: "Show logs",
          cancelText: "Stay here",
        },
      );
      if (showLogs) {
        navigateTo("/admin/logging?source=ipa-hosts:sync");
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const handleClick = async () => {
    const confirmed = await prompts.confirm(
      "This starts an immediate host sync from FreeIPA. FreeIPA remains the source of truth and the local mirror will be refreshed from it.",
      {
        title: "Run host sync",
        icon: "ti ti-refresh",
        confirmText: "Start sync",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await mutation.mutate();
    }
  };

  return (
    <button type="button" class="btn-input btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
      Sync now
    </button>
  );
};

export default SyncHosts;
