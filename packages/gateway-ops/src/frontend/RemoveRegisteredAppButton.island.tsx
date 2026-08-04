import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { Button, prompts, Tooltip, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

const isRemovedApp = (value: unknown): value is { id: string } =>
  Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string");

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
      const response = await apiClient.apps[":id"].$delete({ param: { id: props.id } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to remove app"));
      const body = await response.json();
      if (!isRemovedApp(body)) throw new Error("Unexpected remove response.");
      return body;
    },
    onSuccess: (result) => {
      if (!result || result.id !== props.id) return;
      toast.success("Registered app removed");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <Tooltip.Anchor content={props.disabled ? "Only offline apps can be removed" : "Remove offline app"}>
      <Button type="button" variant="danger" size="sm" disabled={props.disabled || removeApp.loading()} onClick={() => removeApp.mutate()}>
        <i class={`ti ${removeApp.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} />
        Remove
      </Button>
    </Tooltip.Anchor>
  );
}
