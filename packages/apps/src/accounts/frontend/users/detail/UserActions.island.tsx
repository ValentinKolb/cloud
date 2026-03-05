import { createSignal } from "solid-js";
import { Dropdown } from "@valentinkolb/cloud/lib/ui";
import { DateTimeInput } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { apiClient as notificationsApiClient } from "@/notifications/client";
import type { FullUser } from "@/accounts/contracts";
import { CopyButton } from "@valentinkolb/cloud/lib/ui";
import { navigateTo, refreshCurrentPath } from "../../lib/navigation";

type UserActionsProps = {
  user: FullUser;
  memberofGroup: string[];
  manages: string[];
  listHref: string;
};

const hasRole = (roles: FullUser["roles"], ...required: FullUser["roles"][number][]) =>
  required.some((role) => roles.includes(role));

export default function UserActions(props: UserActionsProps) {
  const editMutation = mutations.create<
    void,
    {
      givenname: string;
      sn: string;
      displayName: string;
      mail?: string;
      phone?: string;
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

  const resetPasswordMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"]["reset-password"].$post({
        param: { id: props.user.id },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to reset password.");
      }
      return data;
    },
    onSuccess: (data) => prompts.alert(data.message),
    onError: (err) => prompts.error(err.message),
  });

  const demoteMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"].$delete({
        param: { id: props.user.id },
        query: { mode: "demote" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? "Failed to demote user.");
      }
      return data;
    },
    onSuccess: () => showDemoteSuccessDialog(),
    onError: (err) => prompts.error(err.message),
  });

  const destroyMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient.users[":id"].$delete({
        param: { id: props.user.id },
        query: { mode: "destroy" },
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
      const res = await apiClient.users[":id"]["set-expiry"].$post({
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

  const notifyMutation = mutations.create<{ message: string }, { subject: string; content: string }>({
    mutation: async ({ subject, content }) => {
      const res = await notificationsApiClient.send.$post({
        json: {
          userId: props.user.id,
          subject,
          rawHtml: `<p>${content.replace(/\n/g, "</p><p>")}</p>`,
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
        mailInfo: {
          type: "info" as const,
          content: () => (
            <div class="info-block-warning text-xs">
              The email address is the primary sync key between FreeIPA and the local database. Changing it may affect account linking.
            </div>
          ),
        },
        mail: {
          type: "text" as const,
          label: "Email",
          placeholder: "Email address...",
          icon: "ti ti-mail",
          default: props.user.mail ?? "",
        },
        phone: {
          type: "text" as const,
          label: "Phone",
          placeholder: "Phone number...",
          icon: "ti ti-phone",
          description: "Visible to all account holders.",
          default: props.user.phone ?? "",
        },
      },
    });
    if (result) {
      await editMutation.mutate({
        givenname: result.givenname,
        sn: result.sn,
        displayName: result.displayName,
        mail: result.mail || undefined,
        phone: result.phone || undefined,
      });
    }
  };

  const handleSetExpiry = async () => {
    // Get current expiry date for default value
    const currentExpiry = props.user.ipaAccountExpires ? new Date(props.user.ipaAccountExpires).toISOString().split("T")[0] : "";

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

  const handleDemote = async () => {
    const confirmed = await prompts.confirm(
      <div class="flex flex-col gap-2">
        <p>This will:</p>
        <ul class="list-disc list-inside text-sm text-dimmed">
          <li>Remove user from FreeIPA</li>
          <li>Convert account to guest (preserves email for re-promotion)</li>
          <li>Remove all group memberships</li>
        </ul>
        <p class="text-sm text-amber-600 dark:text-amber-400 mt-2">The user will no longer be able to login with IPA credentials.</p>
      </div>,
      {
        title: `Demote "${props.user.uid}" to Guest?`,
        icon: "ti ti-user-down",
        confirmText: "Make Guest",
        cancelText: "Cancel",
        variant: "danger",
      },
    );

    if (confirmed) {
      demoteMutation.mutate();
    }
  };

  const showDemoteSuccessDialog = () => {
    const nfsCommand = `sudo nfsctl userdel ${props.user.uid}`;

    prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-4">
          <div class="info-block-success">User demoted to guest successfully.</div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">Run on the NFS server:</span>
              <CopyButton text={nfsCommand} label="Copy" />
            </div>
            <pre class="rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 text-xs font-mono overflow-x-auto whitespace-pre">
              {nfsCommand}
            </pre>
          </div>

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
      { title: "User Demoted", icon: "ti ti-check" },
    );
  };

  const handleDestroy = async () => {
    const isIpaUser = hasRole(props.user.roles, "ipa", "ipa-limited");

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
        title: `Destroy "${props.user.uid}"?`,
        icon: "ti ti-trash",
        confirmText: "Destroy",
        cancelText: "Cancel",
        variant: "danger",
      },
    );

    if (confirmed) {
      destroyMutation.mutate();
    }
  };

  const showDestroySuccessDialog = () => {
    const isIpaUser = hasRole(props.user.roles, "ipa", "ipa-limited");
    const nfsCommand = `sudo nfsctl userdel ${props.user.uid}`;

    prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-4">
          <div class="info-block-success">User permanently deleted.</div>

          {isIpaUser && (
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium">Run on the NFS server:</span>
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

  const isIpaUser = hasRole(props.user.roles, "ipa", "ipa-limited");

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
            {
              icon: "ti ti-pencil",
              label: "Edit",
              action: handleEdit,
            },
            {
              icon: "ti ti-send",
              label: "Notify",
              action: handleNotify,
            },
            ...(isIpaUser
              ? [
                  {
                    icon: "ti ti-calendar",
                    label: "Set Expiry",
                    action: handleSetExpiry,
                  },
                ]
              : []),
            ...(isIpaUser
              ? [
                  {
                    icon: "ti ti-lock-open",
                    label: "Reset Password",
                    action: handleResetPassword,
                    variant: "danger" as const,
                  },
                ]
              : []),
          ],
        },
        {
          items: [
            ...(isIpaUser
              ? [
                  {
                    icon: "ti ti-user-down",
                    label: "Make Guest",
                    action: handleDemote,
                    variant: "danger" as const,
                  },
                ]
              : []),
            {
              icon: "ti ti-trash",
              label: "Destroy",
              action: handleDestroy,
              variant: "danger" as const,
            },
          ],
        },
      ]}
    />
  );
}
