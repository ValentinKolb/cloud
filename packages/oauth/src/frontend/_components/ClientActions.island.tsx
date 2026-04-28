import { Dropdown, prompts, CopyButton, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import { clipboard } from "@valentinkolb/stdlib/browser";
import type { OAuthClient, UpdateOAuthClient } from "@/contracts";

type ClientActionsProps = {
  client: OAuthClient;
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

  const currentProfileAccess = client.allowedProfiles.includes("guest") ? "everybody" : "user";

  const handleEdit = async () => {
    const result = await prompts.form({
      title: `Edit: ${client.name}`,
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        clientInfo: {
          type: "info" as const,
          content: (
            <div class="text-xs text-dimmed mb-2 info-block-info">
              <p>
                Client ID: <code class="bg-zinc-50 dark:bg-zinc-800 px-1 rounded">{client.clientId}</code>
              </p>
              <p>Type: {client.isPublic ? "Public" : "Confidential"}</p>
            </div>
          ),
        },
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Optional description for this client",
          icon: "ti ti-file-description",
          default: client.description ?? "",
        },
        redirectUri: {
          type: "text" as const,
          label: "Redirect URI (Callback URL)",
          placeholder: "https://myapp.example.com/callback",
          icon: "ti ti-link",
          required: true,
          default: client.redirectUris[0] ?? "",
        },
        logoutUri: {
          type: "text" as const,
          label: "Logout URI (optional)",
          placeholder: "https://myapp.example.com/logout-callback",
          icon: "ti ti-logout",
          default: client.logoutUri ?? "",
        },
        profileInfo: {
          type: "info" as const,
          content: <div class="text-xs text-dimmed border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">Allowed Profiles</div>,
        },
        profileAccess: {
          type: "select" as const,
          label: "Who can use this client?",
          options: [
            {
              id: "everybody",
              label: "Everybody",
              description: "Full users and guests can use this client.",
            },
            {
              id: "user",
              label: "Full Users Only",
              description: "Only full user accounts can use this client.",
            },
          ],
          default: currentProfileAccess,
          required: true,
        },
        scopesInfo: {
          type: "info" as const,
          content: (
            <div class="text-xs text-dimmed border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
              Scopes (what data the client can access)
            </div>
          ),
        },
        scopeProfile: {
          type: "boolean" as const,
          label: "Profile (name, display name)",
          default: client.scopes.includes("profile"),
        },
        scopeEmail: {
          type: "boolean" as const,
          label: "Email address",
          default: client.scopes.includes("email"),
        },
        scopeGroups: {
          type: "boolean" as const,
          label: "Group memberships",
          default: client.scopes.includes("groups"),
        },
      },
    });

    if (result) {
      const scopes: ("openid" | "profile" | "email" | "groups")[] = ["openid"];
      if (result.scopeProfile) scopes.push("profile");
      if (result.scopeEmail) scopes.push("email");
      if (result.scopeGroups) scopes.push("groups");

      const allowedProfiles: ("user" | "guest")[] = result.profileAccess === "everybody" ? ["user", "guest"] : ["user"];

      // Clean up redirect URI (remove quotes and whitespace)
      const cleanRedirectUri = result.redirectUri.trim().replace(/^["']|["']$/g, "");

      // Clean up logout URI
      const cleanLogoutUri = result.logoutUri?.trim() || null;

      await updateMutation.mutate({
        description: result.description || null,
        redirectUris: [cleanRedirectUri],
        logoutUri: cleanLogoutUri,
        scopes,
        allowedProfiles,
      });
    }
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
