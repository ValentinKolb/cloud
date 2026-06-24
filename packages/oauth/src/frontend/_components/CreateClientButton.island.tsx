import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { dialogCore, panelDialogOptions, prompts, CopyButton } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";
import type { OAuthClientWithSecret, CreateOAuthClient } from "@/contracts";
import OAuthClientDialog from "./OAuthClientDialog";

const clientDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(96vw,72rem)]"),
};

const CreateClientButton = () => {
  const mutation = mutations.create<OAuthClientWithSecret, CreateOAuthClient>({
    mutation: async (data) => {
      const res = await apiClient.index.$post({ json: data });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to create client.");
      }
      return result as OAuthClientWithSecret;
    },
    onSuccess: async (data) => {
      await prompts.alert(
        <div class="space-y-4">
          <div>
            <div class="text-xs text-dimmed mb-1">Client ID</div>
            <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
              <code class="text-sm flex-1 break-all">{data.clientId}</code>
              <CopyButton text={data.clientId} />
            </div>
          </div>
          {data.clientSecret && (
            <div>
              <div class="text-xs text-dimmed mb-1">Client Secret</div>
              <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
                <code class="text-sm flex-1 break-all">{data.clientSecret}</code>
                <CopyButton text={data.clientSecret} />
              </div>
              <div class="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                <i class="ti ti-alert-triangle" />
                Save this secret now - it won't be shown again!
              </div>
            </div>
          )}
          {!data.clientSecret && <div class="text-xs text-dimmed">This is a public client (no secret required).</div>}
        </div>,
        { title: "Client Created", icon: "ti ti-check" },
      );
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    void dialogCore.open<void>(
      (close) => (
        <OAuthClientDialog
          mode="create"
          close={close}
          loading={mutation.loading}
          onSubmit={async (data) => {
            await mutation.mutate(data);
            if (!mutation.error()) close();
          }}
        />
      ),
      clientDialogOptions,
    );
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleCreate}>
      <i class="ti ti-plus" />
      New Client
    </button>
  );
};

export default CreateClientButton;
