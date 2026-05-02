import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import {
  TextInput,
  PermissionEditor,
  navigateTo,
  prompts,
  refreshCurrentPath,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import type { Base } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  base: { id: string; name: string; description: string | null };
  accessEntries: AccessEntry[];
};

/**
 * Single-island settings page body. Sections stack vertically and are
 * separated by horizontal rules — same shape as spaces' SpaceEditPanel,
 * scaled to grids' simpler data model (just name/description + ACL +
 * delete).
 */
export default function BaseSettingsPanel(props: Props) {
  return (
    <div class="flex flex-col gap-8">
      <div class="flex items-center gap-3">
        <a
          href={`/app/grids/${props.base.id}`}
          class="p-1.5 text-dimmed hover:text-primary transition-colors"
          title="Back to base"
        >
          <i class="ti ti-arrow-left" />
        </a>
        <h2 class="text-lg font-semibold">Base Settings</h2>
      </div>

      <section class="flex flex-col gap-2">
        <h3 class="section-label">General</h3>
        <GeneralForm base={props.base} />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="flex flex-col gap-2">
        <h3 class="section-label">Permissions</h3>
        <div class="info-block-info text-xs flex items-start gap-2">
          <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
          <span>
            Base-level grants apply to every table by default. Override per
            table from that table's editor: a group with{" "}
            <code class="font-mono">read</code> on the base and{" "}
            <code class="font-mono">write</code> on a single table can edit
            that table but only read others. Within the same tier, "no
            access" wins; user grants override group grants.
          </span>
        </div>
        <PermissionsSection baseId={props.base.id} initialEntries={props.accessEntries} />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-red-500">Danger Zone</h3>
        <DangerZone baseId={props.base.id} baseName={props.base.name} />
      </section>
    </div>
  );
}

function GeneralForm(props: { base: { id: string; name: string; description: string | null } }) {
  const [name, setName] = createSignal(props.base.name);
  const [description, setDescription] = createSignal(props.base.description ?? "");
  const [hasChanges, setHasChanges] = createSignal(false);

  const update = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setHasChanges(true);
  };

  const mutation = mutations.create<Base, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.base.id },
        json: { name: name().trim(), description: description().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return (await res.json()) as Base;
    },
    onSuccess: () => {
      setHasChanges(false);
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    mutation.mutate(undefined);
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-3">
      <TextInput
        label="Name"
        placeholder="My Base"
        icon="ti ti-typography"
        value={name}
        onInput={update(setName)}
        required
      />
      <TextInput
        label="Description"
        placeholder="Optional description..."
        icon="ti ti-align-left"
        value={description}
        onInput={update(setDescription)}
        multiline
      />
      <Show when={hasChanges()}>
        <button type="submit" disabled={mutation.loading()} class="btn-primary btn-sm self-start mt-2">
          {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </form>
  );
}

function PermissionsSection(props: { baseId: string; initialEntries: AccessEntry[] }) {
  const [entries, setEntries] = createSignal(props.initialEntries);

  return (
    <PermissionEditor
      resourceId={props.baseId}
      initialEntries={entries()}
      canEdit
      grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
        const res = await apiClient.access["by-base"][":baseId"].$post({
          param: { baseId: resourceId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        const listRes = await apiClient.access["by-base"][":baseId"].$get({
          param: { baseId: resourceId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (_resourceId, accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (_resourceId, accessId) => {
        const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}

function DangerZone(props: { baseId: string; baseName: string }) {
  const deleteMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$delete({ param: { baseId: props.baseId } });
      // hono-openapi typed client only declares non-204 statuses; check range manually.
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete base"));
    },
    onSuccess: () => navigateTo("/app/grids"),
    onError: (e) => prompts.error(e.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(
      `This permanently deletes "${props.baseName}" and all of its tables, fields, records, and audit history. This cannot be undone.`,
      { title: "Delete base?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMut.mutate(undefined);
  };

  return (
    <div class="flex flex-col gap-2">
      <p class="text-sm text-secondary">Permanently delete this base and all its contents.</p>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteMut.loading()}
        class="btn-danger btn-md self-start"
      >
        {deleteMut.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-trash mr-1" />
            Delete Base
          </>
        )}
      </button>
    </div>
  );
}
