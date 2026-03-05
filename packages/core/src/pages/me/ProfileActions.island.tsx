import { createSignal, For, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/cloud-lib/browser";
import { prompts } from "@valentinkolb/cloud-lib/ui";
import { apiClient } from "@/api/api-client";
import type { Role } from "@valentinkolb/cloud-contracts/shared";
import { TextInput } from "@valentinkolb/cloud-lib/ui";

type Props = {
  roles: Role[];
  uid: string;
  givenname: string;
  sn: string;
  displayName: string;
  phone: string | null;
  address: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
  };
  sshPublicKeys: string[];
  sshFingerprints: string[];
  appName?: string;
};

const SSH_KEY_PATTERN = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+/;
const hasRole = (roles: Role[], ...required: Role[]) => required.some((role) => roles.includes(role));

export default function ProfileActions(props: Props) {
  const isIpa = hasRole(props.roles, "ipa", "ipa-limited");
  const holders = props.appName ? `${props.appName} account holders` : "all account holders";

  // ── Edit Profile ──

  const editMutation = mutations.create<void, { givenname: string; sn: string; displayName: string; phone?: string }>({
    mutation: async (vars) => {
      const res = await apiClient.me.$patch({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update profile.");
      }
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const handleEditProfile = async () => {
    const result = await prompts.form({
      title: "Edit Profile",
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        notice: {
          type: "info" as const,
          content: () => (
            <div class="info-block-warning text-xs">
              By accepting the terms of service you agreed to use your real name. Misuse will be penalized.
            </div>
          ),
        },
        visibility: {
          type: "info" as const,
          content: () => <p class="text-xs text-dimmed">Your name, display name and phone number are visible to {holders}.</p>,
        },
        givenname: {
          type: "text" as const,
          label: "First Name",
          placeholder: "First name...",
          icon: "ti ti-user",
          required: true,
          default: props.givenname,
        },
        sn: {
          type: "text" as const,
          label: "Last Name",
          placeholder: "Last name...",
          icon: "ti ti-user",
          required: true,
          default: props.sn,
        },
        displayName: {
          type: "text" as const,
          label: "Display Name",
          placeholder: "Display name...",
          icon: "ti ti-id-badge-2",
          required: true,
          default: props.displayName,
        },
        phone: {
          type: "text" as const,
          label: "Phone",
          placeholder: "Phone number...",
          icon: "ti ti-phone",
          default: props.phone ?? "",
        },
      },
    });
    if (result) {
      await editMutation.mutate({
        givenname: result.givenname,
        sn: result.sn,
        displayName: result.displayName,
        phone: result.phone || undefined,
      });
    }
  };

  // ── Edit Address ──

  const addressMutation = mutations.create<void, { street?: string; postalCode?: string; city?: string; state?: string }>({
    mutation: async (vars) => {
      // We need to send givenname/sn/displayName too since UpdateProfileSchema requires them
      const res = await apiClient.me.$patch({
        json: {
          givenname: props.givenname,
          sn: props.sn,
          displayName: props.displayName,
          ...vars,
        },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update address.");
      }
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const handleEditAddress = async () => {
    const result = await prompts.form({
      title: "Edit Address",
      icon: "ti ti-map-pin",
      confirmText: "Save",
      fields: {
        visibility: {
          type: "info" as const,
          content: () => <p class="text-xs text-dimmed">Your address is visible to {holders}.</p>,
        },
        street: {
          type: "text" as const,
          label: "Street",
          placeholder: "Street and house number...",
          icon: "ti ti-road",
          default: props.address.street ?? "",
        },
        postalCode: {
          type: "text" as const,
          label: "Postal Code",
          placeholder: "e.g. 89081",
          icon: "ti ti-mail",
          default: props.address.postalCode ?? "",
        },
        city: {
          type: "text" as const,
          label: "City",
          placeholder: "e.g. Ulm",
          icon: "ti ti-building-community",
          default: props.address.city ?? "",
        },
        state: {
          type: "text" as const,
          label: "State",
          placeholder: "e.g. Baden-Wuerttemberg",
          icon: "ti ti-map",
          default: props.address.state ?? "",
        },
      },
    });
    if (result) {
      await addressMutation.mutate({
        street: result.street || undefined,
        postalCode: result.postalCode || undefined,
        city: result.city || undefined,
        state: result.state || undefined,
      });
    }
  };

  // ── Manage SSH Keys ──

  const sshMutation = mutations.create<void, string[]>({
    mutation: async (keys) => {
      const res = await apiClient.me["ssh-keys"].$put({ json: { keys } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update SSH keys.");
      }
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const handleManageSshKeys = async () => {
    const result = await prompts.dialog<string[] | undefined>(
      (close) => {
        const [keys, setKeys] = createSignal<string[]>([...props.sshPublicKeys]);
        const [newKey, setNewKey] = createSignal("");
        const [error, setError] = createSignal<string | null>(null);

        const addKey = () => {
          const key = newKey().trim();
          if (!key) return;
          if (!SSH_KEY_PATTERN.test(key)) {
            setError("Invalid SSH public key format. Paste the content of your .pub file.");
            return;
          }
          if (keys().includes(key)) {
            setError("This key is already added.");
            return;
          }
          setKeys([...keys(), key]);
          setNewKey("");
          setError(null);
        };

        const removeKey = (index: number) => {
          setKeys(keys().filter((_, i) => i !== index));
        };

        /** Extract a short label from a public key (type + fingerprint-like suffix) */
        const keyLabel = (key: string): string => {
          const parts = key.split(/\s+/);
          const type = parts[0] ?? "ssh";
          const blob = parts[1] ?? "";
          const suffix = blob.length > 20 ? `...${blob.slice(-12)}` : blob;
          const comment = parts[2] ?? "";
          return comment ? `${type} (${comment})` : `${type} ${suffix}`;
        };

        return (
          <div class="flex flex-col gap-4">
            <div class="info-block-info text-xs flex flex-col gap-1">
              <p>
                With SSH keys you can connect to any machine via{" "}
                <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">ssh {props.uid}@host-ip</code>
              </p>
              <p>
                Generate a key: <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">ssh-keygen -t ed25519</code>
                <br />
                Then paste the contents of <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">~/.ssh/id_ed25519.pub</code>{" "}
                below.
              </p>
            </div>

            <p class="text-xs text-dimmed">Your SSH key fingerprints are visible to {holders}.</p>

            {/* Existing keys */}
            <Show when={keys().length > 0}>
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-primary">Your Keys</span>
                <For each={keys()}>
                  {(key, i) => (
                    <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded">
                      <code class="text-xs font-mono text-secondary flex-1 min-w-0 truncate">{keyLabel(key)}</code>
                      <button
                        type="button"
                        onClick={() => removeKey(i())}
                        class="text-red-500 hover:text-red-700 dark:hover:text-red-400 shrink-0"
                        title="Remove key"
                      >
                        <i class="ti ti-trash text-sm" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={keys().length === 0}>
              <p class="text-xs text-dimmed italic">No SSH keys configured.</p>
            </Show>

            {/* Add new key */}
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-primary">Add Key</span>
              <TextInput
                placeholder="ssh-ed25519 AAAA... your-comment"
                icon="ti ti-key"
                value={newKey}
                onInput={(v) => {
                  setNewKey(v);
                  setError(null);
                }}
                multiline
              />
              <Show when={error()}>
                <p class="text-xs text-red-500">{error()}</p>
              </Show>
              <button type="button" onClick={addKey} class="btn-secondary btn-sm self-end">
                <i class="ti ti-plus text-sm" />
                Add
              </button>
            </div>

            {/* Actions */}
            <div class="flex justify-end gap-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
              <button type="button" onClick={() => close(undefined)} class="btn-secondary btn-sm">
                Cancel
              </button>
              <button type="button" onClick={() => close(keys())} class="btn-primary btn-sm">
                Save
              </button>
            </div>
          </div>
        );
      },
      { title: "Manage SSH Keys", icon: "ti ti-key" },
    );
    if (result !== undefined) {
      await sshMutation.mutate(result);
    }
  };

  return (
    <div class="flex flex-wrap gap-2">
      <button type="button" onClick={handleEditProfile} class="btn-secondary btn-sm">
        <i class="ti ti-pencil text-sm" />
        Edit Profile
      </button>
      <Show when={isIpa}>
        <button type="button" onClick={handleEditAddress} class="btn-secondary btn-sm">
          <i class="ti ti-map-pin text-sm" />
          Edit Address
        </button>
        <button type="button" onClick={handleManageSshKeys} class="btn-secondary btn-sm">
          <i class="ti ti-key text-sm" />
          SSH Keys
        </button>
      </Show>
    </div>
  );
}
