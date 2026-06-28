import { createSignal, For, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { Dropdown, prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import type { UserProfile, UserProvider } from "@valentinkolb/cloud/contracts";
import { TextInput } from "@valentinkolb/cloud/ui";

type Props = {
  provider: UserProvider;
  profile: UserProfile;
  uid: string;
  givenname: string;
  sn: string;
  displayName: string;
  ipa: {
    phone: string | null;
    address: {
      street: string | null;
      postalCode: string | null;
      city: string | null;
      state: string | null;
    };
    sshPublicKeys: string[];
    sshFingerprints: string[];
  } | null;
  appName?: string;
  freeIpaEnabled: boolean;
};

const SSH_KEY_PATTERN = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+/;

export default function ProfileActions(props: Props) {
  const isIpa = props.provider === "ipa" && props.freeIpaEnabled;
  const canMutateAccount = props.provider !== "ipa" || props.freeIpaEnabled;
  const holders = props.appName ? `${props.appName} account holders` : "all account holders";

  // ── Edit Profile (name fields) ──

  const editMutation = mutations.create<void, { givenname: string; sn: string; displayName: string }>({
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
          content: () => <p class="text-xs text-dimmed">Your name and display name are visible to {holders}.</p>,
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
      },
    });
    if (result) {
      await editMutation.mutate({
        givenname: result.givenname,
        sn: result.sn,
        displayName: result.displayName,
      });
    }
  };

  // ── Contact & Details (phone + address + SSH keys in one dialog) ──

  const detailsMutation = mutations.create<
    void,
    {
      ipa?: { phone?: string; address?: { street?: string; postalCode?: string; city?: string; state?: string }; sshPublicKeys?: string[] };
    }
  >({
    mutation: async (vars) => {
      const res = await apiClient.me.$patch({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update details.");
      }
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const handleEditDetails = async () => {
    const result = await prompts.dialog<
      { phone: string; street: string; postalCode: string; city: string; state: string; sshKeys: string[] } | undefined
    >(
      (close) => {
        const [phone, setPhone] = createSignal(props.ipa?.phone ?? "");
        const [street, setStreet] = createSignal(props.ipa?.address.street ?? "");
        const [postalCode, setPostalCode] = createSignal(props.ipa?.address.postalCode ?? "");
        const [city, setCity] = createSignal(props.ipa?.address.city ?? "");
        const [state, setState] = createSignal(props.ipa?.address.state ?? "");
        const [keys, setKeys] = createSignal<string[]>([...(props.ipa?.sshPublicKeys ?? [])]);
        const [newKey, setNewKey] = createSignal("");
        const [keyError, setKeyError] = createSignal<string | null>(null);

        const addKey = () => {
          const key = newKey().trim();
          if (!key) return;
          if (!SSH_KEY_PATTERN.test(key)) {
            setKeyError("Invalid SSH public key format. Paste the content of your .pub file.");
            return;
          }
          if (keys().includes(key)) {
            setKeyError("This key is already added.");
            return;
          }
          setKeys([...keys(), key]);
          setNewKey("");
          setKeyError(null);
        };

        const keyLabel = (key: string): { type: string; comment: string; suffix: string } => {
          const parts = key.split(/\s+/);
          const type = parts[0] ?? "ssh";
          const blob = parts[1] ?? "";
          const suffix = blob.length > 8 ? `...${blob.slice(-8)}` : blob;
          const comment = parts.slice(2).join(" ") || "";
          return { type, comment, suffix };
        };

        return (
          <div class="flex flex-col gap-5">
            <p class="text-xs text-dimmed">Phone, address, and SSH key fingerprints are visible to {holders}.</p>

            <div class="flex flex-col gap-3">
              <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">Contact</span>
              <TextInput label="Phone" placeholder="Phone number..." icon="ti ti-phone" value={phone} onInput={setPhone} />
            </div>

            <Show when={isIpa}>
              <div class="flex flex-col gap-3">
                <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">Address</span>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="sm:col-span-2">
                    <TextInput
                      label="Street"
                      placeholder="Street and house number..."
                      icon="ti ti-road"
                      value={street}
                      onInput={setStreet}
                    />
                  </div>
                  <TextInput label="Postal Code" placeholder="e.g. 89081" icon="ti ti-hash" value={postalCode} onInput={setPostalCode} />
                  <TextInput label="City" placeholder="e.g. Ulm" icon="ti ti-building-community" value={city} onInput={setCity} />
                  <div class="sm:col-span-2">
                    <TextInput label="State" placeholder="e.g. Baden-Wuerttemberg" icon="ti ti-map" value={state} onInput={setState} />
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-3">
                <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">SSH Keys</span>
                <div class="info-block-info text-xs flex flex-col gap-1">
                  <p>
                    Connect via <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">ssh {props.uid}@host-ip</code>
                  </p>
                  <p>
                    Generate: <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">ssh-keygen -t ed25519</code>, then paste{" "}
                    <code class="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-[11px]">~/.ssh/id_ed25519.pub</code>
                  </p>
                </div>
                <Show when={keys().length > 0}>
                  <div class="flex flex-col gap-1.5">
                    <For each={keys()}>
                      {(key, i) => {
                        const info = keyLabel(key);
                        return (
                          <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-2 rounded">
                            <div class="flex-1 min-w-0">
                              <span class="text-xs font-medium text-primary block truncate">{info.comment || info.type}</span>
                              <span class="text-[10px] font-mono text-dimmed block truncate">
                                {info.type} {info.suffix}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setKeys(keys().filter((_, idx) => idx !== i()))}
                              class="text-red-500 hover:text-red-700 dark:hover:text-red-400 shrink-0"
                              title="Remove key"
                            >
                              <i class="ti ti-trash text-sm" />
                            </button>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
                <div class="flex flex-col gap-2">
                  <TextInput
                    placeholder="ssh-ed25519 AAAA... your-comment"
                    icon="ti ti-key"
                    value={newKey}
                    onInput={(v) => {
                      setNewKey(v);
                      setKeyError(null);
                    }}
                    multiline
                  />
                  <Show when={keyError()}>
                    <p class="text-xs text-red-500">{keyError()}</p>
                  </Show>
                  <button type="button" onClick={addKey} class="btn-secondary btn-sm self-end">
                    <i class="ti ti-plus text-sm" />
                    Add Key
                  </button>
                </div>
              </div>
            </Show>

            <div class="flex justify-end gap-3 pt-1">
              <button type="button" onClick={() => close(undefined)} class="btn-secondary btn-sm">
                Cancel
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() =>
                  close({ phone: phone(), street: street(), postalCode: postalCode(), city: city(), state: state(), sshKeys: keys() })
                }
              >
                Save
              </button>
            </div>
          </div>
        );
      },
      { title: "Contact & Details", icon: "ti ti-address-book", size: "large" },
    );

    if (!result) return;

    const contactChanged =
      (result.phone || "") !== (props.ipa?.phone ?? "") ||
      (result.street || "") !== (props.ipa?.address.street ?? "") ||
      (result.postalCode || "") !== (props.ipa?.address.postalCode ?? "") ||
      (result.city || "") !== (props.ipa?.address.city ?? "") ||
      (result.state || "") !== (props.ipa?.address.state ?? "");

    const sshChanged =
      result.sshKeys.length !== (props.ipa?.sshPublicKeys.length ?? 0) ||
      result.sshKeys.some((k, i) => k !== (props.ipa?.sshPublicKeys[i] ?? undefined));

    if (contactChanged || sshChanged) {
      await detailsMutation.mutate({
        ipa: {
          phone: result.phone || undefined,
          address: {
            street: result.street || undefined,
            postalCode: result.postalCode || undefined,
            city: result.city || undefined,
            state: result.state || undefined,
          },
          sshPublicKeys: result.sshKeys,
        },
      });
    }
  };

  // ── Extend Account ──

  const extendMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.me["account-extension"].$post();
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to extend account.");
      }
      const data = await res.json();
      await prompts.alert(data.message ?? "Account extended.");
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const actions = [
    ...(canMutateAccount ? [{ icon: "ti ti-pencil", label: "Edit Profile", action: () => void handleEditProfile() }] : []),
    ...(isIpa ? [{ icon: "ti ti-address-book", label: "Contact & Details", action: () => void handleEditDetails() }] : []),
    ...(canMutateAccount
      ? [
          {
            icon: "ti ti-calendar-plus",
            label: extendMutation.loading() ? "Extending..." : "Extend Account",
            action: () => void extendMutation.mutate(),
          },
        ]
      : []),
  ];

  return (
    <Show when={actions.length > 0}>
      <Dropdown
        position="bottom-left"
        width="w-56"
        trigger={
          <span class="btn-secondary btn-sm">
            <i class="ti ti-dots text-sm" />
            Profile actions
          </span>
        }
        elements={actions}
      />
    </Show>
  );
}
