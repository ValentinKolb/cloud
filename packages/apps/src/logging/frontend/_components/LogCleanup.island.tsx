import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/logging/client";
import { refreshCurrentPath } from "../lib/navigation";

const LogCleanup = () => {
  const mutation = mutations.create<{ deleted: number }, number>({
    mutation: async (days) => {
      const res = await apiClient.cleanup.$delete({
        query: { days: String(days) },
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to cleanup logs.");
      }
      return result as { deleted: number };
    },
    onSuccess: async (data) => {
      await prompts.alert(`Deleted ${data.deleted} log entries.`, {
        title: "Cleanup Complete",
        icon: "ti ti-check",
      });
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCleanup = async () => {
    const result = await prompts.form({
      title: "Cleanup Logs",
      icon: "ti ti-trash",
      confirmText: "Delete",
      variant: "danger",
      fields: {
        days: {
          type: "number" as const,
          label: "Delete entries older than (days)",
          default: 30,
          min: 1,
          required: true,
        },
      },
    });

    if (result) {
      await mutation.mutate(result.days);
    }
  };

  return (
    <button type="button" class="btn-simple btn-sm" onClick={handleCleanup} disabled={mutation.loading()}>
      <i class={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
      Cleanup
    </button>
  );
};

export default LogCleanup;
