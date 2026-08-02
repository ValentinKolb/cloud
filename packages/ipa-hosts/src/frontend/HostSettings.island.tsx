import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, prompts, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";

const HostSettings = () => {
  const saveMutation = mutations.create<void, string>({
    mutation: async (cron) => {
      const response = await apiClient.settings["sync-cron"].$put({ json: { cron } });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "Failed to save sync schedule.");
      }
    },
    onSuccess: () => toast.success("Host sync schedule updated"),
    onError: (error) => prompts.error(error.message),
  });

  const handleSettings = async () => {
    const response = await apiClient.settings["sync-cron"].$get();
    let current = "*/5 * * * *";
    let timezone = "Europe/Berlin";
    if (response.ok) {
      const data = await response.json();
      current = data.cron;
      timezone = data.timezone;
    } else {
      prompts.error("Failed to load current sync schedule, using default.");
    }

    const result = await prompts.form({
      title: "Host Sync Settings",
      icon: "ti ti-settings",
      confirmText: "Save",
      fields: {
        sync_cron: {
          type: "text" as const,
          label: "Sync schedule (cron)",
          description: `Five-field cron interpreted in ${timezone}. This only controls how often the local mirror refreshes from FreeIPA.`,
          default: current,
          required: true,
          placeholder: "*/5 * * * *",
        },
      },
    });

    if (!result) return;
    await saveMutation.mutate(result.sync_cron);
  };

  return (
    <Button size="sm" variant="secondary" onClick={handleSettings} loading={saveMutation.loading()} loadingLabel="Saving settings">
      <i class="ti ti-settings" aria-hidden="true" />
      Settings
    </Button>
  );
};

export default HostSettings;
