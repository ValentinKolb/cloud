import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/settings/client";

type SettingsResponse = {
  settings: Array<{ key: string; value: unknown }>;
};

const LogRetention = () => {
  const saveMutation = mutations.create<void, number>({
    mutation: async (days) => {
      const response = await apiClient[":key{.+}"].$put({
        param: { key: "logs.retention_days" },
        json: { value: days },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "Failed to save log retention.");
      }
    },
    onSuccess: () =>
      prompts.alert("Log retention updated.", {
        title: "Saved",
        icon: "ti ti-check",
      }),
    onError: (error) => prompts.error(error.message),
  });

  const handleSettings = async () => {
    // Keep the modal usable even when fetching the current setting fails.
    const res = await apiClient.index.$get();
    let current = 30;
    if (res.ok) {
      const data = (await res.json()) as SettingsResponse;
      const entry = data.settings.find((s) => s.key === "logs.retention_days");
      if (entry?.value != null) current = Number(entry.value);
    } else {
      prompts.error("Failed to load current retention value, using default.");
    }

    const result = await prompts.form({
      title: "Log Settings",
      icon: "ti ti-settings",
      confirmText: "Save",
      fields: {
        retention_days: {
          type: "number" as const,
          label: "Retention (days)",
          default: current,
          min: 1,
          required: true,
        },
      },
    });

    if (result) {
      await saveMutation.mutate(result.retention_days);
    }
  };

  return (
    <button type="button" class="btn-simple btn-sm" onClick={handleSettings} disabled={saveMutation.loading()}>
      <i class={saveMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"} />
      Settings
    </button>
  );
};

export default LogRetention;
