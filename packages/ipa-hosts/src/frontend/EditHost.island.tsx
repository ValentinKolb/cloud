import { Dropdown, Placeholder, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations, timed as timing } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Index, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { normalizeMacAddress } from "@/contracts";

const MAC_ADDRESS_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

type HostActionsProps = {
  fqdn: string;
  description: string | null;
  locality: string | null;
  location: string | null;
  macAddress: string[];
  memberofHostgroup: string[];
  currentGroup?: string;
};

type EditHostPayload = {
  description?: string;
  locality?: string;
  location?: string;
  macAddress?: string[];
};

type EditableMacAddress = {
  value: string;
};

const MacAddressRow = (props: {
  index: number;
  value: () => string;
  error: () => string | undefined;
  onInput: (value: string) => void;
  onRemove: () => void;
}) => {
  return (
    <div class="flex items-start gap-2">
      <div class="flex-1">
        <TextInput
          label={`MAC address ${props.index + 1}`}
          placeholder="AA:BB:CC:DD:EE:FF"
          icon="ti ti-address-book"
          activeIcon="ti ti-address-book"
          value={props.value}
          onInput={props.onInput}
          error={props.error}
        />
      </div>
      <button
        type="button"
        class="icon-btn h-10 w-10 shrink-0"
        onClick={props.onRemove}
        aria-label={`Remove MAC address ${props.index + 1}`}
      >
        <i class="ti ti-trash text-sm text-red-500" />
      </button>
    </div>
  );
};

const HostActions = (props: HostActionsProps) => {
  const editMutation = mutations.create<void, EditHostPayload>({
    mutation: async (vars) => {
      const res = await apiClient[":fqdn"].$patch({ param: { fqdn: props.fqdn }, json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update host.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const deleteMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient[":fqdn"].$delete({ param: { fqdn: props.fqdn } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete host.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const addToGroupMutation = mutations.create<void, string>({
    mutation: async (hostgroup) => {
      const res = await apiClient[":fqdn"].hostgroups.$post({ param: { fqdn: props.fqdn }, json: { hostgroup } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to add host to group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const removeFromGroupMutation = mutations.create<void, string>({
    mutation: async (hostgroup) => {
      const res = await apiClient[":fqdn"].hostgroups.$delete({ param: { fqdn: props.fqdn }, json: { hostgroup } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to remove host from group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const handleRemoveFromGroup = async (groupName: string) => {
    const confirmed = await prompts.confirm(`Remove "${props.fqdn}" from hostgroup "${groupName}"?`, {
      title: "Remove from Group",
      icon: "ti ti-folder-minus",
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await removeFromGroupMutation.mutate(groupName);
    }
  };
  const handleEdit = async () => {
    prompts.dialog(
      (close) => (
        <EditHostDialog
          fqdn={props.fqdn}
          description={props.description}
          locality={props.locality}
          location={props.location}
          macAddress={props.macAddress}
          saving={editMutation.loading()}
          onCancel={close}
          onSave={async (data) => {
            await editMutation.mutate(data);
            close();
          }}
        />
      ),
      { title: `Edit ${props.fqdn}`, icon: "ti ti-pencil", size: "large" },
    );
  };
  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete "${props.fqdn}"? This cannot be undone.`, {
      title: "Delete Host",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await deleteMutation.mutate();
    }
  };
  const handleAddToGroup = () => {
    prompts.dialog(
      (close) => (
        <HostgroupSearch
          exclude={props.memberofHostgroup}
          adding={addToGroupMutation.loading()}
          onSelect={async (cn: string) => {
            close();
            await addToGroupMutation.mutate(cn);
          }}
        />
      ),
      { title: "Add to Hostgroup", icon: "ti ti-server-cog" },
    );
  };
  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="Host actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-44"
      elements={[
        {
          items: [
            { icon: "ti ti-pencil", label: "Edit", action: handleEdit },
            { icon: "ti ti-folder-plus", label: "Add", action: handleAddToGroup },
            ...(props.currentGroup
              ? [
                  {
                    icon: "ti ti-folder-minus",
                    label: "Remove",
                    action: () => handleRemoveFromGroup(props.currentGroup!),
                    variant: "danger" as const,
                  },
                ]
              : []),
            { icon: "ti ti-trash", label: "Delete", action: handleDelete, variant: "danger" as const },
          ],
        },
      ]}
    />
  );
};

const EditHostDialog = (props: {
  fqdn: string;
  description: string | null;
  locality: string | null;
  location: string | null;
  macAddress: string[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (data: EditHostPayload) => Promise<void>;
}) => {
  const [description, setDescription] = createSignal(props.description ?? "");
  const [locality, setLocality] = createSignal(props.locality ?? "");
  const [location, setLocation] = createSignal(props.location ?? "");
  const [macAddresses, setMacAddresses] = createSignal<EditableMacAddress[]>(props.macAddress.map((value) => ({ value })));
  const [macErrors, setMacErrors] = createSignal<string[]>([]);

  const updateMac = (index: number, value: string) => {
    setMacAddresses((current) => current.map((entry, currentIndex) => (currentIndex === index ? { ...entry, value } : entry)));
    setMacErrors((current) => current.map((entry, currentIndex) => (currentIndex === index ? "" : entry)));
  };

  const addMac = () => {
    setMacAddresses((current) => [...current, { value: "" }]);
    setMacErrors((current) => [...current, ""]);
  };

  const removeMac = (index: number) => {
    setMacAddresses((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setMacErrors((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSave = async () => {
    const normalizedMacs = macAddresses().map((entry) => normalizeMacAddress(entry.value));
    const nextErrors = normalizedMacs.map((value, index, values) => {
      if (!value) return "MAC address is required.";
      if (!MAC_ADDRESS_REGEX.test(value)) return "Use format AA:BB:CC:DD:EE:FF.";
      if (values.findIndex((candidate) => candidate === value) !== index) return "Duplicate MAC address.";
      return "";
    });

    setMacErrors(nextErrors);
    if (nextErrors.some(Boolean)) return;

    await props.onSave({
      description: description(),
      locality: locality(),
      location: location(),
      macAddress: normalizedMacs,
    });
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="grid gap-3 md:grid-cols-2">
        <TextInput label="Description" placeholder="Optional description..." value={description} onInput={setDescription} />
        <TextInput label="Locality" placeholder="e.g. Stuttgart" value={locality} onInput={setLocality} />
      </div>
      <TextInput label="Location" placeholder="e.g. Room 101" value={location} onInput={setLocation} />

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-medium text-primary">MAC addresses</h3>
            <p class="text-xs text-dimmed">Add or remove MAC addresses in format AA:BB:CC:DD:EE:FF.</p>
          </div>
          <button type="button" class="btn-simple btn-sm" onClick={addMac}>
            <i class="ti ti-plus" />
            Add MAC
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <Show
            when={macAddresses().length > 0}
            fallback={
              <Placeholder align="left" class="rounded-xl border border-dashed border-subtle p-3">
                No MAC addresses configured.
              </Placeholder>
            }
          >
            <Index each={macAddresses()}>
              {(macAddress, index) => (
                <MacAddressRow
                  index={index}
                  value={() => macAddress().value}
                  error={() => macErrors()[index]}
                  onInput={(value) => updateMac(index, value)}
                  onRemove={() => removeMac(index)}
                />
              )}
            </Index>
          </Show>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button type="button" class="btn-simple btn-sm" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={handleSave} disabled={props.saving}>
          <i class={props.saving ? "ti ti-loader-2 animate-spin" : "ti ti-check"} />
          Save
        </button>
      </div>
    </div>
  );
};

// Inline hostgroup search component
const HostgroupSearch = (props: { exclude: string[]; adding?: boolean; onSelect: (cn: string) => void }) => {
  const [search, setSearch] = createSignal("");
  const [results, setResults] = createSignal<{ cn: string; description: string | null }[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [addingCn, setAddingCn] = createSignal<string | null>(null);
  const doSearch = async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.hostgroups.search.$get({ query: { q, exclude: props.exclude.join(",") } });
      if (!res.ok) {
        throw new Error("Failed to search hostgroups.");
      }
      const data = await res.json();
      setResults(data.hostgroups);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to search hostgroups.");
    } finally {
      setLoading(false);
    }
  };
  const { debouncedFn: debouncedSearch } = timing.debounce(doSearch, 300);
  const handleInput = (value: string) => {
    setSearch(value);
    debouncedSearch(value);
  };
  return (
    <div class="flex flex-col gap-3">
      <TextInput
        type="search"
        placeholder="Search hostgroups..."
        ariaLabel="Search hostgroups"
        icon="ti ti-search"
        activeIcon="ti ti-search"
        value={search}
        onInput={handleInput}
        clearable
        clearLabel="Clear hostgroup search"
        onClear={() => handleInput("")}
      />
      <div class="h-48 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-8 text-dimmed">
            <i class="ti ti-loader-2 animate-spin text-xl" />
          </div>
        </Show>
        <Show when={!loading() && search().length >= 1 && results().length === 0}>
          <div class="flex flex-col items-center justify-center py-8 text-dimmed text-xs">
            <i class="ti ti-search-off text-xl mb-2" /> <span>No hostgroups found</span>
          </div>
        </Show>
        <Show when={!loading() && search().length < 1}>
          <div class="flex flex-col items-center justify-center py-8 text-dimmed text-xs">
            <i class="ti ti-search text-xl mb-2" /> <span>Type to search hostgroups</span>
          </div>
        </Show>
        <Show when={!loading() && results().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={results()}>
              {(hg) => (
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-8 w-8 text-xs">
                    <i class="ti ti-server text-sm" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate">{hg.cn}</div>
                    {hg.description && <div class="text-xs text-dimmed truncate">{hg.description}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingCn(hg.cn);
                      props.onSelect(hg.cn);
                    }}
                    disabled={addingCn() !== null || props.adding}
                    class="p-2 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors disabled:opacity-50"
                    aria-label={`Add to ${hg.cn}`}
                  >
                    <i class={addingCn() === hg.cn ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
export default HostActions;
