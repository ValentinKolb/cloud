import { navigateTo, refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, Placeholder, prompts, TextInput } from "@k2b/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createResource, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { DocumentProfile } from "../../../contracts";
import type { Base, Field, Form, Table } from "../../../service";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";

type TrashResponse = {
  tables: Table[];
  fields: Field[];
  forms: Form[];
};

type DocumentProfileDraft = Required<Record<keyof DocumentProfile, string>>;

const normalizeDocumentProfile = (profile: DocumentProfile = {}): DocumentProfileDraft => ({
  legalName: profile.legalName ?? "",
  senderLine: profile.senderLine ?? "",
  address: profile.address ?? "",
  department: profile.department ?? "",
  contactEmail: profile.contactEmail ?? "",
  phone: profile.phone ?? "",
  url: profile.url ?? "",
  taxId: profile.taxId ?? "",
  registration: profile.registration ?? "",
  bankName: profile.bankName ?? "",
  iban: profile.iban ?? "",
  bic: profile.bic ?? "",
  paymentTerms: profile.paymentTerms ?? "",
  footerText: profile.footerText ?? "",
});

const cleanDocumentProfile = (draft: DocumentProfileDraft): DocumentProfile => {
  const entries = Object.entries(draft)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value.length > 0);
  return Object.fromEntries(entries) as DocumentProfile;
};

export function DocumentProfileForm(props: { base: { id: string; documentProfile: DocumentProfile } }) {
  const draft = createDraft(normalizeDocumentProfile(props.base.documentProfile));
  const patch = (partial: Partial<DocumentProfileDraft>) => draft.patch(partial);
  const value =
    <K extends keyof DocumentProfileDraft>(key: K) =>
    () =>
      draft.draft()[key];

  const mutation = mutations.create<Base, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.base.id },
        json: { documentProfile: cleanDocumentProfile(draft.draft()) },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save document profile"));
      return res.json();
    },
    onSuccess: (next) => {
      draft.markSaved(normalizeDocumentProfile(next.documentProfile));
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <form
      class="grid grid-cols-1 gap-3 lg:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(undefined);
      }}
    >
      <TextInput label="Legal name" icon="ti ti-building" value={value("legalName")} onValueChange={(v) => patch({ legalName: v })} />
      <TextInput label="Department" icon="ti ti-users" value={value("department")} onValueChange={(v) => patch({ department: v })} />
      <div class="lg:col-span-2">
        <TextInput
          label="Sender line"
          description="Shown above recipient address blocks."
          icon="ti ti-mail-forward"
          value={value("senderLine")}
          onValueChange={(v) => patch({ senderLine: v })}
        />
      </div>
      <div class="lg:col-span-2">
        <TextInput
          label="Address"
          icon="ti ti-map-pin"
          value={value("address")}
          onValueChange={(v) => patch({ address: v })}
          multiline
          lines={3}
        />
      </div>
      <TextInput label="Contact email" icon="ti ti-mail" value={value("contactEmail")} onValueChange={(v) => patch({ contactEmail: v })} />
      <TextInput label="Phone" icon="ti ti-phone" value={value("phone")} onValueChange={(v) => patch({ phone: v })} />
      <TextInput label="Website" icon="ti ti-link" value={value("url")} onValueChange={(v) => patch({ url: v })} />
      <TextInput label="Tax ID / VAT" icon="ti ti-receipt-tax" value={value("taxId")} onValueChange={(v) => patch({ taxId: v })} />
      <TextInput
        label="Registration"
        icon="ti ti-certificate"
        value={value("registration")}
        onValueChange={(v) => patch({ registration: v })}
      />
      <TextInput label="Bank" icon="ti ti-building-bank" value={value("bankName")} onValueChange={(v) => patch({ bankName: v })} />
      <TextInput label="IBAN" icon="ti ti-credit-card" value={value("iban")} onValueChange={(v) => patch({ iban: v })} />
      <TextInput label="BIC" icon="ti ti-credit-card" value={value("bic")} onValueChange={(v) => patch({ bic: v })} />
      <div class="lg:col-span-2">
        <TextInput
          label="Payment terms"
          icon="ti ti-calendar-dollar"
          value={value("paymentTerms")}
          onValueChange={(v) => patch({ paymentTerms: v })}
          multiline
          lines={2}
        />
      </div>
      <div class="lg:col-span-2">
        <TextInput
          label="Footer text"
          icon="ti ti-text-caption"
          value={value("footerText")}
          onValueChange={(v) => patch({ footerText: v })}
          multiline
          lines={2}
        />
      </div>
      <Show when={draft.dirty()}>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={mutation.loading()}
          loadingLabel="Saving document profile"
          class="self-start lg:col-span-2"
        >
          Save document profile
        </Button>
      </Show>
    </form>
  );
}

export function TrashSection(props: { baseId: string }) {
  // Lazy-load on mount via createResource — trash is base-admin-only
  // and rarely viewed, so we don't bloat the SSR payload with it.
  const [trash, { refetch }] = createResource<TrashResponse>(async () => {
    const res = await apiClient.bases[":baseId"].trash.$get({ param: { baseId: props.baseId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load trash"));
    return res.json();
  });

  const restoreTable = async (id: string) => {
    const res = await apiClient.tables[":tableId"].restore.$post({ param: { tableId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore table"));
      return;
    }
    refetch();
    refreshCurrentPath();
  };

  const restoreField = async (id: string) => {
    const res = await apiClient.fields[":fieldId"].restore.$post({ param: { fieldId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore field"));
      return;
    }
    refetch();
  };

  const restoreForm = async (id: string) => {
    const res = await apiClient.forms[":formId"].restore.$post({ param: { formId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore form"));
      return;
    }
    refetch();
  };

  const formatDeletedAt = (iso: string | null) => {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleDateString();
  };

  return (
    <Show when={!trash.loading} fallback={<Placeholder state="loading" align="left" title="Loading…" />}>
      <Show
        when={
          trash() &&
          (trash()!.tables.length > 0 || trash()!.fields.length > 0 || trash()!.forms.length > 0)
        }
        fallback={<Placeholder align="left" class="px-0 py-1" description={<>Trash is empty.</>} />}
      >
        <div class="flex flex-col gap-4">
          <Show when={trash()!.tables.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Tables</p>
              <For each={trash()!.tables}>
                {(t) => (
                  <TrashRow icon="ti-table" name={t.name} deletedAt={formatDeletedAt(t.deletedAt)} onRestore={() => restoreTable(t.id)} />
                )}
              </For>
            </div>
          </Show>
          <Show when={trash()!.fields.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Fields</p>
              <For each={trash()!.fields}>
                {(f) => (
                  <TrashRow icon="ti-columns" name={f.name} deletedAt={formatDeletedAt(f.deletedAt)} onRestore={() => restoreField(f.id)} />
                )}
              </For>
            </div>
          </Show>
          <Show when={trash()!.forms.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Forms</p>
              <For each={trash()!.forms}>
                {(form) => (
                  <TrashRow
                    icon="ti-forms"
                    name={form.name}
                    deletedAt={formatDeletedAt(form.deletedAt)}
                    onRestore={() => restoreForm(form.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
}

function TrashRow(props: { icon: string; name: string; deletedAt: string; onRestore: () => void }) {
  return (
    <div class="flex items-center gap-2 py-1.5">
      <i class={`ti ${props.icon} text-dimmed shrink-0`} />
      <span class="flex-1 min-w-0 truncate text-sm">{props.name}</span>
      <Show when={props.deletedAt}>
        <span class="text-[11px] text-dimmed">deleted {props.deletedAt}</span>
      </Show>
      <Button variant="ghost" size="sm" type="button" class="shrink-0" onClick={props.onRestore}>
        <i class="ti ti-arrow-back-up" /> Restore
      </Button>
    </div>
  );
}

export function GeneralForm(props: { base: { id: string; name: string; description: string | null } }) {
  const draft = createDraft({
    name: props.base.name,
    description: props.base.description ?? "",
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
  };
  const name = () => draft.draft().name;
  const description = () => draft.draft().description;

  const mutation = mutations.create<Base, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.base.id },
        json: { name: name().trim(), description: description().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return res.json();
    },
    onSuccess: (next) => {
      draft.markSaved({
        name: next.name,
        description: next.description ?? "",
      });
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
        onValueChange={(v) => patch({ name: v })}
        required
      />
      <TextInput
        label="Description"
        placeholder="Optional description..."
        icon="ti ti-align-left"
        value={description}
        onValueChange={(v) => patch({ description: v })}
        multiline
      />
      <Show when={draft.dirty()}>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={mutation.loading()}
          loadingLabel="Saving view defaults"
          class="self-start mt-2"
        >
          Save
        </Button>
      </Show>
    </form>
  );
}

export function PermissionsSection(props: { baseId: string; initialEntries: AccessEntry[] }) {
  return <ScopedPermissionEditor scope={{ type: "base", id: props.baseId }} initialEntries={props.initialEntries} canEdit />;
}

export function DangerZone(props: { baseId: string; baseName: string }) {
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
    const confirmed = await prompts.confirm(`Move "${props.baseName}" and its tables out of the active app? The grid remains restorable.`, {
      title: "Move grid to trash?",
      variant: "danger",
      confirmText: "Move to trash",
    });
    if (!confirmed) return;
    deleteMut.mutate(undefined);
  };

  return (
    <Button
      variant="danger"
      size="sm"
      type="button"
      onClick={handleDelete}
      loading={deleteMut.loading()}
      loadingLabel="Deleting base"
      class="self-start"
    >
      <i class="ti ti-trash mr-1" />
      Delete base
    </Button>
  );
}
