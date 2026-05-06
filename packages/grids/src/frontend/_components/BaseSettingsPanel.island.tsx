import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { navigateTo, PermissionEditor, prompts, refreshCurrentPath, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Base } from "../../service";
import { errorMessage } from "./api-helpers";
import { SectionCard } from "./SectionCard";

type Props = {
  base: { id: string; name: string; description: string | null };
  accessEntries: AccessEntry[];
};

/**
 * Settings page body. Each section is its own paper card; the page
 * header sits on the page background. Mirrors the table-edit page so
 * the two settings surfaces feel like one product.
 */
export default function BaseSettingsPanel(props: Props) {
  return (
    <div class="flex flex-col gap-4">
      <header class="flex items-center gap-3">
        <a href={`/app/grids/${props.base.id}`} class="p-1.5 text-dimmed hover:text-primary transition-colors" title="Back to base">
          <i class="ti ti-arrow-left" />
        </a>
        <h1 class="text-xl font-semibold text-primary">Base settings</h1>
      </header>

      <SectionCard title="General" subtitle="Base name and description shown on the grids overview.">
        <GeneralForm base={props.base} />
      </SectionCard>

      <SectionCard title="Permissions" subtitle="Base-level grants apply to every table by default.">
        <div class="info-block-info text-xs flex items-start gap-2">
          <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
          <span>
            Override per table from that table's editor: a group with <code class="font-mono">read</code> on the base and{" "}
            <code class="font-mono">write</code> on a single table can edit that table but only read others. Within the same tier, "no
            access" wins; user grants override group grants.
          </span>
        </div>
        <PermissionsSection baseId={props.base.id} initialEntries={props.accessEntries} />
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this base and all of its contents. This cannot be undone."
        variant="danger"
      >
        <DangerZone baseId={props.base.id} baseName={props.base.name} />
      </SectionCard>
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
      <TextInput label="Name" placeholder="My Base" icon="ti ti-typography" value={name} onInput={update(setName)} required />
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
      initialEntries={entries()}
      canEdit
      grantAccess={async (principal, permission) => {
        const res = await apiClient.access["by-base"][":baseId"].$post({
          param: { baseId: props.baseId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        const listRes = await apiClient.access["by-base"][":baseId"].$get({
          param: { baseId: props.baseId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (accessId) => {
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
    <button type="button" onClick={handleDelete} disabled={deleteMut.loading()} class="btn-danger btn-sm self-start">
      {deleteMut.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-trash mr-1" />
          Delete base
        </>
      )}
    </button>
  );
}
