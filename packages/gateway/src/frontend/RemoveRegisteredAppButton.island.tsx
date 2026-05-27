import { prompts, refreshCurrentPath, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

export default function RemoveRegisteredAppButton(props: { id: string; name: string; disabled?: boolean }) {
  const removeApp = mutation.create<{ id: string } | null, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        `Remove "${props.name}" from the registered apps list? It will reappear if it starts and heartbeats again.`,
        {
          title: "Remove offline app",
          icon: "ti ti-trash",
          confirmText: "Remove",
          variant: "danger",
        },
      );
      if (!confirmed) return null;
      const response = await fetch(`/api/gateway/apps/${encodeURIComponent(props.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to remove app"));
      return (await response.json()) as { id: string };
    },
    onSuccess: (result) => {
      if (!result || result.id !== props.id) return;
      toast.success("Registered app removed");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <button
      type="button"
      class="btn-simple btn-sm text-red-500 hover:text-red-600"
      disabled={props.disabled || removeApp.loading()}
      title={props.disabled ? "Only offline apps can be removed" : "Remove offline app"}
      onClick={() => removeApp.mutate()}
    >
      <i class={`ti ${removeApp.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} />
      Remove
    </button>
  );
}
