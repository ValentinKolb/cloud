import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts, CopyButton } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";
import type { OAuthClientWithSecret, CreateOAuthClient } from "@/contracts";

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
    const result = await prompts.form({
      title: "New OAuth Client",
      icon: "ti ti-plus",
      confirmText: "Create",
      fields: {
        name: {
          type: "text" as const,
          label: "Name",
          placeholder: "My Application",
          icon: "ti ti-tag",
          required: true,
        },
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Optional description for this client",
          icon: "ti ti-file-description",
        },
        redirectUri: {
          type: "text" as const,
          label: "Redirect URI (Callback URL)",
          placeholder: "https://myapp.example.com/callback",
          icon: "ti ti-link",
          required: true,
        },
        logoutUri: {
          type: "text" as const,
          label: "Logout URI (optional)",
          placeholder: "https://myapp.example.com/logout-callback",
          icon: "ti ti-logout",
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
              id: "user",
              label: "Full Users Only",
              description: "Only full user accounts can use this client.",
            },
            {
              id: "everybody",
              label: "Everybody",
              description: "Full users and guests can use this client.",
            },
          ],
          default: "user",
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
          default: true,
        },
        scopeEmail: {
          type: "boolean" as const,
          label: "Email address",
          default: true,
        },
        scopeGroups: {
          type: "boolean" as const,
          label: "Group memberships",
          default: false,
        },
        clientTypeInfo: {
          type: "info" as const,
          content: <div class="text-xs text-dimmed border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">Client Type</div>,
        },
        isPublic: {
          type: "boolean" as const,
          label: "Public client (browser apps without backend - requires PKCE)",
          default: false,
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
      const cleanLogoutUri = result.logoutUri?.trim() || undefined;

      await mutation.mutate({
        name: result.name,
        description: result.description || undefined,
        redirectUris: [cleanRedirectUri],
        logoutUri: cleanLogoutUri,
        scopes,
        allowedProfiles,
        isPublic: !!result.isPublic,
      });
    }
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleCreate}>
      <i class="ti ti-plus" />
      New Client
    </button>
  );
};

export default CreateClientButton;
