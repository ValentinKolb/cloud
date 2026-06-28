import { createSignal, For, Show } from "solid-js";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import type { WebAuthnPasskey } from "@valentinkolb/cloud/contracts";
import { Placeholder, prompts, TextInput } from "@valentinkolb/cloud/ui";

type Props = {
  initialPasskeys: WebAuthnPasskey[];
  surface?: "paper" | "section";
};

function PasskeyCreateDialog(props: { close: (value: { name: string } | null) => void }) {
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | undefined>();

  const submit = () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    props.close({ name: trimmedName });
  };

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextInput
        label="Name"
        description="Shown in your account so you can identify this passkey later."
        placeholder="e.g. MacBook Touch ID"
        icon="ti ti-tag"
        value={name}
        onInput={(value) => {
          setName(value);
          setError(undefined);
        }}
        error={error}
        required
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(null)}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm">
          <i class="ti ti-fingerprint" />
          Add passkey
        </button>
      </div>
    </form>
  );
}

export default function PasskeysSettings(props: Props) {
  const [passkeys, setPasskeys] = createSignal<WebAuthnPasskey[]>(props.initialPasskeys);
  const rootClass = () => (props.surface === "section" ? "min-w-0" : "paper p-5");

  const createMutation = mutations.create<WebAuthnPasskey, { name: string }>({
    mutation: async (vars) => {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionsRes = await apiClient.me.passkeys.registration.start.$post();
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error((options as { message?: string }).message ?? "Failed to start passkey registration.");

      const response = await startRegistration({ optionsJSON: options as never });
      const verifyRes = await apiClient.me.passkeys.registration.verify.$post({
        json: { name: vars.name, response },
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error((data as { message?: string }).message ?? "Failed to add passkey.");
      return data as WebAuthnPasskey;
    },
    onSuccess: (passkey) => {
      setPasskeys([passkey, ...passkeys()]);
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<void, { id: string; name: string }, { id: string }>({
    onBefore: (vars) => ({ id: vars.id }),
    mutation: async (vars) => {
      const res = await apiClient.me.passkeys[":id"].$delete({ param: { id: vars.id } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete passkey.");
      }
    },
    onSuccess: (_, ctx) => {
      if (ctx?.id) setPasskeys(passkeys().filter((passkey) => passkey.id !== ctx.id));
    },
    onError: (err) => prompts.error(err.message),
  });

  const openCreate = async () => {
    const result = await prompts.dialog<{ name: string } | null>((close) => <PasskeyCreateDialog close={close} />, {
      title: "Add passkey",
      icon: "ti ti-fingerprint",
      size: "medium",
    });
    if (result) await createMutation.mutate(result);
  };

  const remove = async (passkey: WebAuthnPasskey) => {
    const confirmed = await prompts.confirm(`Delete "${passkey.name}"? This passkey will no longer sign in to your account.`, {
      title: "Delete passkey",
      icon: "ti ti-fingerprint-off",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) await deleteMutation.mutate({ id: passkey.id, name: passkey.name });
  };

  return (
    <section class={rootClass()}>
      <div class="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <i class="ti ti-fingerprint text-sm" />
            Passkeys
          </h2>
          <p class="mt-1 text-xs text-dimmed">Use device passkeys such as Touch ID, Windows Hello, or security keys to sign in.</p>
        </div>
        <button type="button" class="btn-secondary btn-sm shrink-0" onClick={openCreate} disabled={createMutation.loading()}>
          <i class="ti ti-plus" />
          Add
        </button>
      </div>

      <Show
        when={passkeys().length > 0}
        fallback={
          <Placeholder surface="paper" icon="ti ti-fingerprint">
            No passkeys yet.
          </Placeholder>
        }
      >
        <div class="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <For each={passkeys()}>
            {(passkey) => (
              <div class="flex items-center gap-3 p-3">
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-medium text-primary">{passkey.name}</span>
                    {passkey.backedUp && (
                      <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">synced</span>
                    )}
                  </div>
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dimmed">
                    <span>Created {dates.formatDate(passkey.createdAt)}</span>
                    <span>{passkey.lastUsedAt ? `Used ${dates.formatDateTimeRelative(passkey.lastUsedAt)}` : "Never used"}</span>
                    {passkey.transports.length > 0 && <span>{passkey.transports.join(", ")}</span>}
                  </div>
                </div>
                <button type="button" class="btn-simple btn-sm shrink-0 text-red-600 dark:text-red-400" onClick={() => remove(passkey)}>
                  <i class="ti ti-trash" />
                  Delete
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
