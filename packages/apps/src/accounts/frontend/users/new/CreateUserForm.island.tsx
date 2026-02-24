import { createSignal, createEffect, Show } from "solid-js";
import { apiClient } from "@/accounts/client";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { Checkbox } from "@valentinkolb/cloud/lib/ui";
import { CopyButton } from "@valentinkolb/cloud/lib/ui";

// Note: UID is auto-generated (abbreviation) for new users, or reused from guest on promotion.
// Alias (vorname.nachname) is generated automatically in the backend.

/** Deny button for account requests */
function DenyButton(props: { requestId: string; email: string; firstName: string }) {
  const mutation = mutations.create<void, { reason?: string }>({
    mutation: async (vars) => {
      const res = await apiClient["account-requests"][":id"].deny.$post({
        param: { id: props.requestId },
        json: vars,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to deny request.");
      }
    },
    onSuccess: () => {
      window.location.href = "/app/accounts/users";
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "Deny Account Request",
      icon: "ti ti-x",
      confirmText: "Deny Request",
      variant: "danger",
      fields: {
        info: {
          type: "info",
          content: () => (
            <div class="info-block-warning text-xs">
              Are you sure you want to deny the request from <strong>{props.firstName}</strong> ({props.email})?
            </div>
          ),
        },
        reason: {
          type: "text",
          multiline: true,
          label: "Reason (optional)",
          placeholder: "Explain why the request was denied...",
          description: "If provided, an email with this reason will be sent to the user.",
        },
      },
    });

    if (result !== null) {
      await mutation.mutate({
        reason: result.reason || undefined,
      });
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={mutation.loading()} class="btn-danger btn-sm">
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-x" />}
      <span>Deny</span>
    </button>
  );
}

type CreateUserResult = {
  id: string;
  uid: string;
  accountExpires: string | null;
  notificationSent: boolean;
};

type PrefillData = {
  requestId: string;
  email: string;
  givenname: string;
  sn: string;
  displayName?: string;
  firstName: string;
};

type Props = {
  prefill?: PrefillData;
};

export default function CreateUserForm(props: Props) {
  // Form state - initialize from prefill if available
  const [email, setEmail] = createSignal(props.prefill?.email ?? "");
  const [givenname, setGivenname] = createSignal(props.prefill?.givenname ?? "");
  const [sn, setSn] = createSignal(props.prefill?.sn ?? "");
  const [displayName, setDisplayName] = createSignal(props.prefill?.displayName ?? "");
  const [autoSendNotification, setAutoSendNotification] = createSignal(true);

  // Track if user has manually edited these fields
  const [displayNameManuallySet, setDisplayNameManuallySet] = createSignal(!!props.prefill?.displayName);

  // Auto-populate displayName when first/last name changes
  createEffect(() => {
    if (!displayNameManuallySet()) {
      const autoDisplayName = [givenname(), sn()].filter(Boolean).join(" ");
      setDisplayName(autoDisplayName);
    }
  });

  const mutation = mutations.create<CreateUserResult, void>({
    mutation: async () => {
      const res = await apiClient.users.$post({
        json: {
          email: email(),
          givenname: givenname(),
          sn: sn(),
          displayName: displayName() || undefined,
          autoSendNotification: autoSendNotification(),
          requestId: props.prefill?.requestId,
        },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create user");
      }
      return res.json() as Promise<CreateUserResult>;
    },
    onSuccess: (data) => {
      showSuccessDialog(data);
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const showConfirmationDialog = async () => {
    // Validate required fields
    if (!email()) {
      prompts.error("Email is required");
      return;
    }
    if (!givenname()) {
      prompts.error("First name is required");
      return;
    }
    if (!sn()) {
      prompts.error("Last name is required");
      return;
    }

    const confirmed = await prompts.confirm(
      <div class="flex flex-col gap-3 text-sm">
        <p>Create user with the following data?</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt class="text-dimmed">Email</dt>
          <dd class="font-mono">{email()}</dd>
          <dt class="text-dimmed">Name</dt>
          <dd>
            {givenname()} {sn()}
          </dd>
          <dt class="text-dimmed">Display Name</dt>
          <dd>{displayName() || `${givenname()} ${sn()}`}</dd>
          <dt class="text-dimmed">UID</dt>
          <dd class="font-mono text-dimmed italic">(auto-generated or from guest)</dd>
        </dl>
      </div>,
      {
        title: "Confirm User Creation",
        icon: "ti ti-user-plus",
        confirmText: "Create User",
      },
    );

    if (confirmed) {
      mutation.mutate();
    }
  };

  const showSuccessDialog = (data: CreateUserResult) => {
    const nfsCommands = `sudo nfsctl useradd ${data.uid}`;

    prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-4">
          <div class="info-block-success">
            User <code class="font-mono font-semibold">{data.uid}</code> created successfully!
          </div>

          {/* Notification status */}
          <div class={data.notificationSent ? "info-block-success" : "info-block-warning"}>
            {data.notificationSent ? (
              <span>
                <i class="ti ti-mail-check mr-1" />
                Welcome email with temporary password sent.
              </span>
            ) : (
              <span>
                <i class="ti ti-mail-pause mr-1" />
                Welcome email queued (not sent yet). Check notifications to send.
              </span>
            )}
          </div>

          {/* User details */}
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt class="text-dimmed">UID</dt>
            <dd class="font-mono">{data.uid}</dd>
            {data.accountExpires && (
              <>
                <dt class="text-dimmed">Account expires</dt>
                <dd>{new Date(data.accountExpires).toLocaleDateString("de-DE")}</dd>
              </>
            )}
          </dl>

          {/* NFS commands */}
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">Run on the NFS server:</span>
              <CopyButton text={nfsCommands} label="Copy" />
            </div>
            <pre class="rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 text-xs font-mono overflow-x-auto whitespace-pre">
              {nfsCommands}
            </pre>
          </div>

          <div class="flex justify-end gap-3">
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => {
                close();
                // Reset form for creating another user
                setEmail("");
                setGivenname("");
                setSn("");
                setDisplayName("");
                setDisplayNameManuallySet(false);
                setAutoSendNotification(true);
              }}
            >
              Create Another
            </button>
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => {
                close();
                window.location.href = `/app/accounts/users/${data.id}`;
              }}
            >
              View User
            </button>
          </div>
        </div>
      ),
      { title: "User Created", icon: "ti ti-check" },
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        showConfirmationDialog();
      }}
      class="flex flex-col gap-6"
    >
      {/* Email */}
      <TextInput label="Email" placeholder="max.mustermann@example.de" icon="ti ti-mail" value={email} onChange={setEmail} required />

      {/* First Name */}
      <TextInput label="First Name" placeholder="Max" icon="ti ti-user" value={givenname} onChange={setGivenname} required />

      {/* Last Name */}
      <TextInput label="Last Name" placeholder="Mustermann" icon="ti ti-user" value={sn} onChange={setSn} required />

      {/* Display Name */}
      <TextInput
        label="Display Name"
        placeholder="Max Mustermann"
        icon="ti ti-id-badge-2"
        description="Auto-populated from first and last name if left empty"
        value={displayName}
        onChange={(v) => {
          setDisplayName(v);
          setDisplayNameManuallySet(true);
        }}
      />

      {/* UID (auto-generated) */}
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium">UID</p>
        <div class="input-subtle flex items-center gap-2 px-3 py-2 text-dimmed bg-zinc-100 dark:bg-zinc-800 rounded-lg">
          <i class="ti ti-id text-sm" />
          <span class="italic text-sm">Auto-generated abbreviation (or reused from guest account)</span>
        </div>
      </div>

      {/* Auto-send notification */}
      <Checkbox
        label="Send welcome email immediately"
        description="If disabled, the email will be queued and can be sent later from notifications."
        value={autoSendNotification}
        onChange={setAutoSendNotification}
      />

      {/* Error Display */}
      <Show when={mutation.error()}>
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      </Show>

      {/* Submit Button */}
      <div class="flex justify-end gap-3">
        <a href="/app/accounts/users" class="btn-secondary btn-sm">
          Cancel
        </a>
        {props.prefill && (
          <DenyButton requestId={props.prefill.requestId} email={props.prefill.email} firstName={props.prefill.firstName} />
        )}
        <button type="submit" class={`${props.prefill ? "btn-success" : "btn-primary"} btn-sm`} disabled={mutation.loading()}>
          {mutation.loading() ? (
            <i class="ti ti-loader-2 animate-spin" />
          ) : (
            <>
              <i class="ti ti-user-plus" />
              <span>Create User</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
