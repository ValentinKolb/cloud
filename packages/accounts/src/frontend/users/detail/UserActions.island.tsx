import { createSignal, type JSX } from "solid-js";
import { Dropdown } from "@valentinkolb/cloud/ui";
import { DateTimeInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { User } from "@/contracts";
import { CopyButton } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const toSafeParagraphHtml = (value: string): string =>
  value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

type UserActionsProps = {
  user: User;
  listHref: string;
  freeIpaEnabled: boolean;
};

function SecretField(props: { label: string; value: string; copyLabel?: string; tone?: "default" | "primary" }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[11px] font-semibold uppercase tracking-[0.28em] text-dimmed">{props.label}</span>
        <CopyButton text={props.value} label={props.copyLabel ?? "Copy"} />
      </div>
      <pre
        class={`overflow-x-auto whitespace-pre-wrap break-all rounded-2xl px-4 py-3 text-sm font-mono leading-relaxed ${
          props.tone === "primary"
            ? "bg-blue-50 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100"
            : "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
        }`}
      >
        {props.value}
      </pre>
    </div>
  );
}

function openCredentialDialog(config: {
  title: string;
  icon: string;
  intro: JSX.Element;
  fields: Array<{ label: string; value: string; copyLabel?: string; tone?: "default" | "primary" }>;
}) {
  return prompts.dialog<void>(
    (close) => (
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2 text-sm leading-relaxed text-dimmed">{config.intro}</div>
        <div class="flex flex-col gap-4">
          {config.fields.map((field) => (
            <SecretField label={field.label} value={field.value} copyLabel={field.copyLabel} tone={field.tone} />
          ))}
        </div>
        <div class="flex justify-end">
          <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
            Done
          </button>
        </div>
      </div>
    ),
    { title: config.title, icon: config.icon },
  );
}

export default function UserActions(props: UserActionsProps) {
  const editMutation = mutations.create<
    void,
    {
      givenname: string;
      sn: string;
      displayName: string;
      mail?: string;
      ipa?: {
        phone?: string;
      };
    }
  >({
    mutation: async (vars) => {
      const res = await apiClient.users[":id"].$patch({
        param: { id: props.user.id },
        json: vars,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update user.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const resetPasswordMutation = mutations.create<{ message: string; password: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"]["password-reset"].$post({
        param: { id: props.user.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to reset password.");
      }
      return await res.json();
    },
    onSuccess: (data) =>
      openCredentialDialog({
        title: "Temporary password created",
        icon: "ti ti-lock-open",
        intro: (
          <>
            <p>A new temporary password has been generated for this FreeIPA account.</p>
            <p>The user will be required to set a new password on the next login.</p>
          </>
        ),
        fields: [{ label: "Temporary password", value: data.password, copyLabel: "Copy password", tone: "primary" }],
      }),
    onError: (err) => prompts.error(err.message),
  });

  const destroyMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"].$delete({
        param: { id: props.user.id },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to delete user.");
      }
      return data;
    },
    onSuccess: () => showDestroySuccessDialog(),
    onError: (err) => prompts.error(err.message),
  });

  const setExpiryMutation = mutations.create<{ message: string }, string | null>({
    mutation: async (expiryDate) => {
      const res = await apiClient.users[":id"].expiry.$put({
        param: { id: props.user.id },
        json: { expiryDate },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to set expiry.");
      }
      return data;
    },
    onSuccess: (data) => {
      prompts.alert(data.message);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const setProfileMutation = mutations.create<{ message: string }, "user" | "guest">({
    mutation: async (profile) => {
      const res = await apiClient.users[":id"].profile.$put({
        param: { id: props.user.id },
        json: { profile },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to update local profile.");
      }
      return data;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const setAdminMutation = mutations.create<{ message: string }, boolean>({
    mutation: async (admin) => {
      const res = await apiClient.users[":id"].admin.$put({
        param: { id: props.user.id },
        json: { admin },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to update local admin access.");
      }
      return data;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const createIpaMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"].provider.$put({
        param: { id: props.user.id },
        json: { provider: "ipa" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to create IPA account.");
      }
      return data;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const makeLocalMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"].provider.$put({
        param: { id: props.user.id },
        json: { provider: "local" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to switch provider to local.");
      }
      return data;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const createLoginTokenMutation = mutations.create<{ token: string; magicLink: string; expiresInSeconds: number }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"]["login-token"].$post({
        param: { id: props.user.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to create login token.");
      }
      return await res.json();
    },
    onSuccess: (data) =>
      openCredentialDialog({
        title: "Login token created",
        icon: "ti ti-key",
        intro: (
          <>
            <p>No email was sent. This one-time login token stays valid for about {Math.ceil(data.expiresInSeconds / 60)} minutes.</p>
            <p>You can either share the raw token or use the direct login link below.</p>
          </>
        ),
        fields: [
          { label: "Login token", value: data.token, copyLabel: "Copy token", tone: "primary" },
          { label: "Direct login link", value: data.magicLink, copyLabel: "Copy link" },
        ],
      }),
    onError: (err) => prompts.error(err.message),
  });

  const notifyMutation = mutations.create<{ message: string }, { subject: string; content: string }>({
    mutation: async ({ subject, content }) => {
      const res = await apiClient.users[":id"].notifications.$post({
        param: { id: props.user.id },
        json: {
          subject,
          rawHtml: toSafeParagraphHtml(content),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to send notification.");
      }
      return data;
    },
    onSuccess: (data) => prompts.alert(data.message),
    onError: (err) => prompts.error(err.message),
  });

  const handleResetPassword = async () => {
    const confirmed = await prompts.confirm(
      `This will generate a temporary password for "${props.user.uid}". The user will need to set a new password on next login.`,
      {
        title: "Reset Password",
        icon: "ti ti-lock-open",
        confirmText: "Reset",
        cancelText: "Cancel",
        variant: "danger",
      },
    );
    if (confirmed) {
      await resetPasswordMutation.mutate();
    }
  };

  const handleEdit = async () => {
    const result = await prompts.form({
      title: "Edit User",
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        givenname: {
          type: "text" as const,
          label: "First Name",
          placeholder: "First name...",
          icon: "ti ti-user",
          required: true,
          default: props.user.givenname,
        },
        sn: {
          type: "text" as const,
          label: "Last Name",
          placeholder: "Last name...",
          icon: "ti ti-user",
          required: true,
          default: props.user.sn,
        },
        displayName: {
          type: "text" as const,
          label: "Display Name",
          placeholder: "Display name...",
          icon: "ti ti-id-badge-2",
          required: true,
          default: props.user.displayName,
        },
        ...(props.user.provider === "ipa"
          ? {
              mailInfo: {
                type: "info" as const,
                content: () => (
                  <div class="info-block-warning text-xs">
                    The email address is the primary sync key between FreeIPA and the local database. Changing it may affect account
                    linking.
                  </div>
                ),
              },
            }
          : {}),
        mail: {
          type: "text" as const,
          label: "Email",
          placeholder: "Email address...",
          icon: "ti ti-mail",
          default: props.user.mail ?? "",
        },
        ...(props.user.provider === "ipa"
          ? {
              phone: {
                type: "text" as const,
                label: "Phone",
                placeholder: "Phone number...",
                icon: "ti ti-phone",
                description: "Visible to all account holders.",
                default: props.user.ipa?.phone ?? "",
              },
            }
          : {}),
      },
    });
    if (result) {
      await editMutation.mutate({
        givenname: result.givenname,
        sn: result.sn,
        displayName: result.displayName,
        mail: result.mail || undefined,
        ...(props.user.provider === "ipa" ? { ipa: { phone: result.phone || undefined } } : {}),
      });
    }
  };

  const handleSetExpiry = async () => {
    // Get current expiry date for default value
    const currentExpiry = props.user.accountExpires ? new Date(props.user.accountExpires).toISOString().split("T")[0] : "";

    prompts.dialog<void>(
      (close) => {
        const [expiryDate, setExpiryDate] = createSignal(currentExpiry);

        const handleSubmit = async (date: string | null) => {
          try {
            await setExpiryMutation.mutate(date);
            close();
          } catch {
            // Error is shown by onError callback
          }
        };

        return (
          <div class="flex flex-col gap-4">
            <DateTimeInput
              label="Expiry Date"
              description="Leave empty and click 'Remove Expiry' to make the account never expire."
              value={expiryDate}
              onChange={setExpiryDate}
              dateOnly
            />

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="btn-secondary btn-sm"
                onClick={async () => {
                  const confirmed = await prompts.confirm(
                    "This will allow the account to remain active indefinitely without an expiration date.",
                    {
                      title: "Set to Never Expire?",
                      icon: "ti ti-infinity",
                      confirmText: "Never Expire",
                      cancelText: "Cancel",
                    },
                  );
                  if (confirmed) {
                    handleSubmit(null);
                  }
                }}
                disabled={setExpiryMutation.loading()}
              >
                Never Expire
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => handleSubmit(expiryDate() || null)}
                disabled={setExpiryMutation.loading() || !expiryDate()}
              >
                {setExpiryMutation.loading() ? "Saving..." : "Set Expiry"}
              </button>
            </div>
          </div>
        );
      },
      { title: "Set Account Expiry", icon: "ti ti-calendar" },
    );
  };

  const handleNotify = async () => {
    const result = await prompts.form({
      title: `Notify ${props.user.displayName || props.user.uid}`,
      icon: "ti ti-send",
      confirmText: "Send",
      fields: {
        subject: {
          type: "text" as const,
          label: "Subject",
          placeholder: "Notification subject...",
          icon: "ti ti-mail",
          required: true,
        },
        content: {
          type: "text" as const,
          label: "Message",
          placeholder: "Write your message here...",
          multiline: true,
          required: true,
        },
      },
    });

    if (result) {
      await notifyMutation.mutate({
        subject: result.subject,
        content: result.content,
      });
    }
  };

  const handleSetProfile = async (profile: "user" | "guest") => {
    const confirmed = await prompts.confirm(
      profile === "guest"
        ? "This converts the local account to the guest profile. Guest expiry starts to apply, limited-access behavior is used, and any local admin access is removed."
        : "This converts the local account to the user profile. Guest expiry is removed and full local account behavior is used.",
      {
        title: profile === "guest" ? `Set "${props.user.uid}" to Guest?` : `Set "${props.user.uid}" to Full Account?`,
        icon: profile === "guest" ? "ti ti-user-down" : "ti ti-user-up",
        confirmText: profile === "guest" ? "Set Guest Account" : "Set Full Account",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await setProfileMutation.mutate(profile);
    }
  };

  const handleSetAdmin = async (admin: boolean) => {
    const confirmed = await prompts.confirm(
      admin
        ? `Grant local admin access to "${props.user.uid}"? This only applies while the account is managed locally.`
        : `Revoke local admin access from "${props.user.uid}"?`,
      {
        title: admin ? "Grant Local Admin" : "Revoke Local Admin",
        icon: admin ? "ti ti-shield-check" : "ti ti-shield-x",
        confirmText: admin ? "Grant Admin" : "Revoke Admin",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await setAdminMutation.mutate(admin);
    }
  };

  const handleCreateIpa = async () => {
    const confirmed = await prompts.confirm(
      <div class="flex flex-col gap-2">
        <p>This creates a matching FreeIPA account for this local account and switches its provider to IPA.</p>
        <ul class="list-disc list-inside text-sm text-dimmed">
          <li>The account keeps its current UID and email.</li>
          <li>The local account remains the same database identity.</li>
          <li>Local group relations stay local.</li>
          <li>Future IPA group memberships and guest/user profile are derived from IPA group sync.</li>
        </ul>
      </div>,
      {
        title: `Switch "${props.user.uid}" to FreeIPA?`,
        icon: "ti ti-brand-open-source",
        confirmText: "Create FreeIPA Account",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await createIpaMutation.mutate();
    }
  };

  const handleMakeLocal = async () => {
    const confirmed = await prompts.confirm(
      <div class="flex flex-col gap-2">
        <p>This removes the matching FreeIPA account and switches the local identity row to local account management.</p>
        <ul class="list-disc list-inside text-sm text-dimmed">
          <li>The database identity stays the same.</li>
          <li>Local group relations stay untouched.</li>
          <li>IPA-backed groups and manager assignments are removed.</li>
          <li>The current full/guest profile is preserved.</li>
        </ul>
      </div>,
      {
        title: `Switch "${props.user.uid}" to Local?`,
        icon: "ti ti-home-move",
        confirmText: "Make Local",
        cancelText: "Cancel",
      },
    );
    if (confirmed) {
      await makeLocalMutation.mutate();
    }
  };

  const handleCreateLoginToken = async () => {
    const confirmed = await prompts.confirm(
      `Create a one-time local login token for "${props.user.mail ?? props.user.uid}"? No email will be sent.`,
      {
        title: "Create Login Token",
        icon: "ti ti-key",
        confirmText: "Create Token",
        cancelText: "Cancel",
      },
    );

    if (confirmed) {
      await createLoginTokenMutation.mutate();
    }
  };

  const handleDestroy = async () => {
    const isIpaUser = props.user.provider === "ipa";

    const confirmed = await prompts.confirm(
      <div class="flex flex-col gap-2">
        <p>
          This will <strong>permanently delete</strong> the user:
        </p>
        <ul class="list-disc list-inside text-sm text-dimmed">
          {isIpaUser && <li>Remove from FreeIPA</li>}
          <li>Delete from local database</li>
          <li>This action cannot be undone!</li>
        </ul>
      </div>,
      {
        title: `Delete "${props.user.uid}"?`,
        icon: "ti ti-trash",
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "danger",
      },
    );

    if (confirmed) {
      destroyMutation.mutate();
    }
  };

  const showDestroySuccessDialog = () => {
    const isIpaUser = props.user.provider === "ipa";
    const nfsCommand = `sudo nfsctl userdel ${props.user.uid}`;

    prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-4">
          <div class="info-block-success">User permanently deleted.</div>

          {isIpaUser && (
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium">Only needed if your team manages NFS home directories manually:</span>
                <CopyButton text={nfsCommand} label="Copy" />
              </div>
              <pre class="rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                {nfsCommand}
              </pre>
            </div>
          )}

          <div class="flex justify-end">
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => {
                close();
                navigateTo(props.listHref);
              }}
            >
              Back to Users
            </button>
          </div>
        </div>
      ),
      { title: "User Deleted", icon: "ti ti-check" },
    );
  };

  const isIpaUser = props.user.provider === "ipa";
  const isLocalUser = props.user.provider === "local";
  const canMutateUser = !isIpaUser || props.freeIpaEnabled;
  const isGuestProfile = props.user.profile === "guest";
  const isLocalAdmin = isLocalUser && props.user.roles.includes("admin");
  const canCreateIpa = props.freeIpaEnabled && isLocalUser && Boolean(props.user.mail);
  const canCreateLoginToken = isLocalUser && Boolean(props.user.mail);
  const canSetExpiry = canMutateUser;

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="User actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-48"
      elements={[
        {
          items: [
            ...(canMutateUser
              ? [
                  {
                    icon: "ti ti-pencil",
                    label: "Edit",
                    action: handleEdit,
                  },
                ]
              : []),
            {
              icon: "ti ti-send",
              label: "Notify",
              action: handleNotify,
            },
            ...(canSetExpiry
              ? [
                  {
                    icon: "ti ti-calendar",
                    label: "Set Expiry",
                    action: handleSetExpiry,
                  },
                ]
              : []),
            ...(isIpaUser && props.freeIpaEnabled
              ? [
                  {
                    icon: "ti ti-home-move",
                    label: "Make Local",
                    action: handleMakeLocal,
                  },
                  {
                    icon: "ti ti-lock-open",
                    label: "Reset Password",
                    action: handleResetPassword,
                    variant: "danger" as const,
                  },
                ]
              : []),
            ...(isLocalUser
              ? [
                  ...(canCreateLoginToken
                    ? [
                        {
                          icon: "ti ti-key",
                          label: "Login Token",
                          action: handleCreateLoginToken,
                        },
                      ]
                    : []),
                  {
                    icon: isGuestProfile ? "ti ti-user-up" : "ti ti-user-down",
                    label: isGuestProfile ? "Promote" : "Demote",
                    action: () => handleSetProfile(isGuestProfile ? "user" : "guest"),
                  },
                  ...(isGuestProfile
                    ? []
                    : [
                        {
                          icon: isLocalAdmin ? "ti ti-shield-x" : "ti ti-shield-check",
                          label: isLocalAdmin ? "Revoke Admin" : "Grant Admin",
                          action: () => handleSetAdmin(!isLocalAdmin),
                        },
                      ]),
                ]
              : []),
            ...(canCreateIpa
              ? [
                  {
                    icon: "ti ti-building-fortress",
                    label: "Create FreeIPA",
                    action: handleCreateIpa,
                  },
                ]
              : []),
          ],
        },
        {
          items: [
            ...(canMutateUser
              ? [
                  {
                    icon: "ti ti-trash",
                    label: "Delete",
                    action: handleDestroy,
                    variant: "danger" as const,
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
}
