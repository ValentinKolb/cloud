import { Dropdown, prompts, CopyButton, dialogCore, panelDialogOptions } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import { clipboard } from "@valentinkolb/stdlib/browser";
import type { OAuthClient, UpdateOAuthClient } from "@/contracts";
import OAuthClientDialog from "./OAuthClientDialog";

type ClientActionsProps = {
  client: OAuthClient;
};

const clientDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(96vw,72rem)]"),
};

const ClientActions = (props: ClientActionsProps) => {
  const { client } = props;

  const updateMutation = mutations.create<{ message: string }, UpdateOAuthClient>({
    mutation: async (data) => {
      const res = await apiClient[":id"].$put({
        param: { id: client.id },
        json: data,
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to update client.");
      }
      return result as { message: string };
    },
    onSuccess: async () => {
      await prompts.alert("Client updated successfully.");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: client.id },
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to delete client.");
      }
      return result as { message: string };
    },
    onSuccess: async () => {
      await prompts.alert("Client deleted successfully.");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const regenerateSecretMutation = mutations.create<{ clientSecret: string }, void>({
    mutation: async () => {
      const res = await apiClient[":id"]["regenerate-secret"].$post({
        param: { id: client.id },
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to regenerate secret.");
      }
      return result as { clientSecret: string };
    },
    onSuccess: async (data) => {
      await prompts.alert(
        <div class="space-y-3">
          <div>
            <div class="text-xs text-dimmed mb-1">New Client Secret</div>
            <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
              <code class="text-sm flex-1 break-all">{data.clientSecret}</code>
              <CopyButton text={data.clientSecret} />
            </div>
          </div>
          <div class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <i class="ti ti-alert-triangle" />
            Save this secret now - it won't be shown again!
          </div>
        </div>,
        {
          title: "Secret Regenerated",
          icon: "ti ti-key",
        },
      );
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleEdit = async () => {
    void dialogCore.open<void>(
      (close) => (
        <OAuthClientDialog
          mode="edit"
          client={client}
          close={close}
          loading={updateMutation.loading}
          onSubmit={async (data) => {
            await updateMutation.mutate(data);
            if (!updateMutation.error()) close();
          }}
        />
      ),
      clientDialogOptions,
    );
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(
      `Are you sure you want to delete "${client.name}"? This will invalidate all tokens for this client.`,
      {
        title: "Delete Client?",
        icon: "ti ti-trash",
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "danger",
      },
    );
    if (confirmed) {
      await deleteMutation.mutate();
    }
  };

  const handleRegenerateSecret = async () => {
    const confirmed = await prompts.confirm(
      "This will invalidate the current secret. The application will need to be updated with the new secret.",
      {
        title: "Regenerate Secret?",
        icon: "ti ti-key",
        confirmText: "Regenerate",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await regenerateSecretMutation.mutate();
    }
  };

  const handleCopyClientId = () => {
    clipboard.copy(client.clientId);
    prompts.alert("Client ID copied to clipboard.", {
      title: "Copied",
      icon: "ti ti-check",
    });
  };

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="Client actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-48"
      elements={[
        {
          items: [
            {
              icon: "ti ti-copy",
              label: "Copy Client ID",
              action: handleCopyClientId,
            },
            {
              icon: "ti ti-pencil",
              label: "Edit",
              action: handleEdit,
            },
            ...(!client.isPublic
              ? [
                  {
                    icon: "ti ti-key",
                    label: "Regenerate",
                    action: handleRegenerateSecret,
                  },
                ]
              : []),
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: handleDelete,
              variant: "danger",
            },
          ],
        },
      ]}
    />
  );
};

export default ClientActions;
