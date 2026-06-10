import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  CheckboxCard,
  IconInput,
  LogEntriesTable,
  type LogTableEntry,
  PermissionEditor,
  prompts,
  ResourceApiKeys,
  type ResourceApiKey,
  SelectInput,
  SettingsModal,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { Link, navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { type Accessor, createEffect, createMemo, createResource, createSignal, type Setter, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook, NoteTreeNode } from "../sidebar/types";
import { readSettings, writeSettings } from "./NotebookSettingsStore";

type Props = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  isAdmin: boolean;
  canWrite: boolean;
};

type NoteSelectOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};

type BackupStatus = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  scheduleCron: string;
  accessKeyIdSet: boolean;
  secretAccessKeySet: boolean;
  configured: boolean;
  missing: string[];
  target: string | null;
};

type BackupRunResult = {
  message: string;
  exportedAt: string;
  filename: string;
  bytes: number;
  sha256: string;
  paths: {
    latestZip: string;
    snapshotZip: string;
    manifest: string;
  };
};

type BackupDraft = Pick<BackupStatus, "enabled" | "endpoint" | "region" | "bucket">;

const flattenNoteOptions = (nodes: NoteTreeNode[], depth = 0): NoteSelectOption[] =>
  nodes.flatMap((note) => [
    {
      id: note.shortId,
      label: `${"\u00A0\u00A0".repeat(depth)}${note.title || "Untitled"}`,
      description: `#${note.shortId}`,
      icon: note.lockedAt ? "ti ti-lock" : "ti ti-file-text",
    },
    ...flattenNoteOptions(note.children, depth + 1),
  ]);

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
  } catch {
    // Keep the caller-provided fallback.
  }
  return fallback;
};

const backupDraftFromStatus = (status: BackupStatus): BackupDraft => ({
  enabled: status.enabled,
  endpoint: status.endpoint,
  region: status.region || "us-east-1",
  bucket: status.bucket,
});

const backupDraftIsDirty = (draft: BackupDraft, base: BackupDraft, accessKeyId: string, secretAccessKey: string): boolean =>
  draft.enabled !== base.enabled ||
  draft.endpoint.trim() !== base.endpoint ||
  (draft.region.trim() || "us-east-1") !== base.region ||
  draft.bucket.trim() !== base.bucket ||
  accessKeyId.trim().length > 0 ||
  secretAccessKey.trim().length > 0;

const snapshotLogEntryFromRun = (run: BackupRunResult, notebookShortId: string): LogTableEntry => ({
  id: `local:${run.sha256}`,
  level: "info",
  source: "notebooks:snapshot:s3",
  message: run.message,
  metadata: {
    trigger: "manual",
    notebookShortId,
    bytes: run.bytes,
    sha256: run.sha256,
    latestZip: run.paths.latestZip,
    snapshotZip: run.paths.snapshotZip,
  },
  createdAt: run.exportedAt,
});

export const openNotebookSettingsDialog = (props: Props): Promise<void> =>
  prompts.dialog<void>((close) => <NotebookSettingsBody {...props} bare close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "large",
  });

function LocalSaveStrip(props: { dirty: boolean; loading: boolean; label?: string; onSave: () => void }) {
  return (
    <Show
      when={props.dirty}
      fallback={
        <p class="flex items-center gap-1.5 text-xs text-dimmed">
          <i class="ti ti-check text-emerald-500" />
          Saved
        </p>
      }
    >
      <div class="paper flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-200">
        <span class="flex items-center gap-1.5">
          <i class="ti ti-pencil" />
          Unsaved changes
        </span>
        <button type="button" class="btn-primary btn-sm ml-auto" disabled={props.loading} onClick={props.onSave}>
          {props.loading ? (
            <>
              <i class="ti ti-loader-2 animate-spin" />
              Saving
            </>
          ) : (
            (props.label ?? "Save")
          )}
        </button>
      </div>
    </Show>
  );
}

const settingsChoiceClass = (active: boolean) =>
  `paper relative rounded-lg p-4 text-left transition-[background-color,box-shadow,color] ${
    active
      ? "text-blue-700 dark:text-blue-300 before:absolute before:left-2 before:top-4 before:h-3.5 before:w-0.5 before:rounded-full before:bg-blue-500 dark:before:bg-blue-400"
      : "text-secondary"
  }`;

function SaveStatus(props: { loading: boolean; saved: boolean; error?: string | null }) {
  if (props.loading) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-dimmed">
        <i class="ti ti-loader-2 animate-spin" />
        Saving...
      </span>
    );
  }
  if (props.error) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <i class="ti ti-alert-circle" />
        Failed
      </span>
    );
  }
  if (props.saved) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <i class="ti ti-check" />
        Saved
      </span>
    );
  }
  return null;
}

// =============================================================================
// General
// =============================================================================

function GeneralSection(props: {
  notebook: Notebook;
  tree: NoteTreeNode[];
  canWrite: boolean;
  onNotebookChange: (notebook: Notebook) => void;
}) {
  const options = createMemo(() => flattenNoteOptions(props.tree));
  const [base, setBase] = createSignal({
    name: props.notebook.name,
    description: props.notebook.description ?? "",
    icon: props.notebook.icon ?? "",
    homepageNoteId: props.notebook.homepageNoteShortId ?? "",
  });
  const [name, setName] = createSignal(base().name);
  const [description, setDescription] = createSignal(base().description);
  const [icon, setIcon] = createSignal(base().icon);
  const [homepageNoteId, setHomepageNoteId] = createSignal(base().homepageNoteId);

  const selectedLabel = () => options().find((option) => option.id === homepageNoteId())?.label;
  const dirty = () =>
    name() !== base().name || description() !== base().description || icon() !== base().icon || homepageNoteId() !== base().homepageNoteId;

  const fetchNotes = async (query: string, signal: AbortSignal): Promise<NoteSelectOption[]> => {
    if (signal.aborted) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? options().filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q)) : options();
    return filtered.slice(0, 50);
  };

  const mutation = mutations.create({
    mutation: async () => {
      if (!name().trim()) throw new Error("Name is required");
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          icon: icon().trim() || null,
          homepageNoteId: homepageNoteId() || null,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update notebook."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setBase({
        name: next.name,
        description: next.description ?? "",
        icon: next.icon ?? "",
        homepageNoteId: next.homepageNoteShortId ?? "",
      });
      props.onNotebookChange(next);
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Name"
          description="Shown in the sidebar and overview."
          value={name}
          onInput={setName}
          icon="ti ti-notebook"
          required
          disabled={!props.canWrite}
        />
        <IconInput
          label="Icon"
          description="Used in the sidebar header."
          value={icon}
          onChange={setIcon}
          placeholder="Search icons..."
          disabled={!props.canWrite}
        />
      </div>

      <TextInput
        label="Description"
        description="Optional short note for the overview."
        value={description}
        onInput={setDescription}
        multiline
        lines={2}
        placeholder="What is this notebook for?"
        icon="ti ti-align-left"
        disabled={!props.canWrite}
      />

      <SelectInput
        label="Homepage"
        description="Opened when this notebook has no URL note and no valid last active note."
        value={homepageNoteId}
        onChange={setHomepageNoteId}
        selectedLabel={selectedLabel}
        fetchData={fetchNotes}
        placeholder="Select a note..."
        icon="ti ti-home"
        activeIcon="ti ti-search"
        clearable
        disabled={!props.canWrite}
      />

      <Show
        when={props.canWrite}
        fallback={<p class="text-xs text-dimmed">You can view this notebook, but only editors can change identity settings.</p>}
      >
        <LocalSaveStrip dirty={dirty()} loading={mutation.loading()} onSave={() => mutation.mutate(undefined)} />
      </Show>
    </div>
  );
}

// =============================================================================
// View
// =============================================================================

function ViewSection(props: { notebook: Notebook }) {
  const [mode, setMode] = createSignal(readSettings(props.notebook.shortId).sidebarMode);

  const selectMode = (next: "simple" | "navigator") => {
    if (next === mode()) return;
    setMode(next);
    writeSettings(props.notebook.shortId, { sidebarMode: next });
    window.location.reload();
  };

  return (
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <button type="button" class={settingsChoiceClass(mode() === "simple")} onClick={() => selectMode("simple")}>
        <span class="flex items-center gap-2 text-sm font-semibold">
          <i class="ti ti-layout-sidebar" />
          Simple sidebar
        </span>
        <span class="mt-1 block text-xs text-dimmed">A compact note tree with quick actions.</span>
      </button>
      <button type="button" class={settingsChoiceClass(mode() === "navigator")} onClick={() => selectMode("navigator")}>
        <span class="flex items-center gap-2 text-sm font-semibold">
          <i class="ti ti-layout-list" />
          Navigator
        </span>
        <span class="mt-1 block text-xs text-dimmed">Roots, tags, favorites, and a metadata-rich note list.</span>
      </button>
    </div>
  );
}

// =============================================================================
// Features
// =============================================================================

function FeaturesSection(props: { notebook: Notebook; isAdmin: boolean; onNotebookChange: (notebook: Notebook) => void }) {
  const [enabled, setEnabled] = createSignal(props.notebook.scriptsEnabled);
  const [saved, setSaved] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const mutation = mutations.create<Notebook, boolean>({
    mutation: async (next) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: { scriptsEnabled: next },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update scripting setting."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setEnabled(next.scriptsEnabled);
      setSaved(true);
      setError(null);
      props.onNotebookChange(next);
    },
    onError: (err) => {
      setEnabled(props.notebook.scriptsEnabled);
      setSaved(false);
      setError(err.message);
      prompts.error(err.message);
    },
  });

  const setScriptsEnabled = async (next: boolean) => {
    if (next && !enabled()) {
      const confirmed = await prompts.confirm(
        `Script blocks run trusted JavaScript in the browser of every user who opens notes in this notebook. They can read notebook content visible to that user, use script APIs, call browser APIs, and perform notebook actions with that user's permissions.\n\nOnly enable scripts for notebooks where you trust the content and the people who can edit it.\n\nEnable scripting in "${props.notebook.name}"?`,
        {
          title: "Enable scripting",
          icon: "ti ti-alert-triangle",
          variant: "danger",
          confirmText: "Enable",
        },
      );
      if (!confirmed) return;
    }
    setEnabled(next);
    setSaved(false);
    setError(null);
    mutation.mutate(next);
  };

  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <ViewSection notebook={props.notebook} />
      </div>

      <div class="flex flex-col gap-3">
        <CheckboxCard
          label="Enable script blocks"
          description="Allows ```script fences to run trusted JavaScript for everyone who opens this notebook."
          icon="ti ti-code"
          value={enabled}
          onChange={setScriptsEnabled}
          disabled={!props.isAdmin || mutation.loading()}
        />
        <div class="info-block-warning flex items-start gap-2 text-xs">
          <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
          <span>
            Scripts run in each viewer's browser. They are not sandboxed and can use browser APIs, read notebook content visible to that
            viewer, and perform notebook actions with that viewer's permissions.
          </span>
        </div>
        <SaveStatus loading={mutation.loading()} saved={saved()} error={error()} />
      </div>
    </div>
  );
}

// =============================================================================
// Export
// =============================================================================

function SnapshotUploadAction(props: {
  enabled: boolean;
  configured: boolean;
  loading: boolean;
  disabled: boolean;
  lastRun: BackupRunResult | null;
  onRun: () => void;
}) {
  return (
    <Show when={props.enabled}>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" disabled={props.disabled || !props.configured} onClick={props.onRun}>
          <Show when={!props.loading} fallback={<i class="ti ti-loader-2 animate-spin" />}>
            <i class="ti ti-cloud-upload" />
            Upload now
          </Show>
        </button>
        <Show when={props.lastRun}>
          {(result) => <span class="text-xs text-emerald-600 dark:text-emerald-300">Uploaded {Math.round(result().bytes / 1024)} KB.</span>}
        </Show>
      </div>
    </Show>
  );
}

function SnapshotConfigFields(props: {
  notebookShortId: string;
  enabled: Accessor<boolean>;
  setEnabled: Setter<boolean>;
  endpoint: Accessor<string>;
  setEndpoint: Setter<string>;
  region: Accessor<string>;
  setRegion: Setter<string>;
  bucket: Accessor<string>;
  setBucket: Setter<string>;
  accessKeyId: Accessor<string>;
  setAccessKeyId: Setter<string>;
  secretAccessKey: Accessor<string>;
  setSecretAccessKey: Setter<string>;
  status: BackupStatus | undefined;
  missing: string;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <CheckboxCard
        label="Enable S3 snapshots"
        description="Writes latest.zip, a timestamped snapshot, and latest-manifest.json to your bucket."
        icon="ti ti-cloud-upload"
        value={props.enabled}
        onChange={props.setEnabled}
        disabled={props.saving}
      />

      <div class="paper px-3 py-2 text-xs text-secondary">
        Automatic schedule: <span class="font-mono text-primary">{props.status?.scheduleCron ?? "0 3 * * *"}</span>
        <span class="ml-2 text-dimmed">Cloud admins edit it in /admin/notebooks.</span>
      </div>

      <Show when={props.enabled()}>
        <div class="grid gap-3">
          <TextInput
            label="Endpoint"
            value={props.endpoint}
            onInput={props.setEndpoint}
            placeholder="https://..."
            icon="ti ti-link"
            type="url"
          />
          <div class="info-block-info flex items-start gap-2 text-xs">
            <i class="ti ti-info-circle mt-0.5 shrink-0" />
            <div>
              <p class="font-medium text-primary">S3-compatible endpoint</p>
              <p class="mt-0.5 text-dimmed">
                Uses Bun's S3 client with virtual-hosted-style requests. Hetzner Object Storage works with endpoints like{" "}
                <code>https://nbg1.your-objectstorage.com</code>, <code>https://fsn1.your-objectstorage.com</code>, or{" "}
                <code>https://hel1.your-objectstorage.com</code>. Use the matching region such as <code>nbg1</code>. Objects are written
                below <code>notebooks/{props.notebookShortId}/</code>.
              </p>
            </div>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <TextInput label="Region" value={props.region} onInput={props.setRegion} placeholder="eu-central-1" icon="ti ti-map" />
            <TextInput
              label="Bucket"
              value={props.bucket}
              onInput={props.setBucket}
              placeholder="my-notebook-backups"
              icon="ti ti-bucket"
            />
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <TextInput
              label="Access key ID"
              value={props.accessKeyId}
              onInput={props.setAccessKeyId}
              placeholder={props.status?.accessKeyIdSet ? "Stored - leave empty to keep" : ""}
              icon="ti ti-key"
            />
            <TextInput
              label="Secret access key"
              value={props.secretAccessKey}
              onInput={props.setSecretAccessKey}
              placeholder={props.status?.secretAccessKeySet ? "Stored - leave empty to keep" : ""}
              icon="ti ti-lock"
              password
            />
          </div>
          <div class="paper px-3 py-2 text-xs text-secondary">
            Target: <span class="font-medium text-primary">{props.status?.target ?? "not configured"}</span>
            <Show when={props.missing !== "none"}>
              <span class="ml-2 text-amber-600 dark:text-amber-300">Missing: {props.missing}</span>
            </Show>
          </div>
        </div>
      </Show>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary btn-sm" disabled={props.saving || !props.dirty} onClick={props.onSave}>
          <Show when={!props.saving} fallback={<i class="ti ti-loader-2 animate-spin" />}>
            <i class="ti ti-device-floppy" />
            Save snapshot settings
          </Show>
        </button>
      </div>
    </>
  );
}

function SnapshotLogsSection(props: { show: boolean; entries: LogTableEntry[]; loading: boolean; error: string | null }) {
  return (
    <Show when={props.show}>
      <div class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold">Recent snapshots</h3>
        <Show
          when={!props.error}
          fallback={
            <div class="info-block-error flex items-start gap-2 text-xs">
              <i class="ti ti-alert-circle mt-0.5 shrink-0" />
              <span>{props.error}</span>
            </div>
          }
        >
          <LogEntriesTable
            entries={props.entries}
            emptyMessage={props.loading ? "Loading snapshot logs..." : "No snapshot runs logged yet."}
          />
        </Show>
      </div>
    </Show>
  );
}

function ExportSection(props: { notebook: Notebook; isAdmin: boolean }) {
  const href = () => `/api/notebooks/${encodeURIComponent(props.notebook.shortId)}/export.zip`;
  const [lastRun, setLastRun] = createSignal<BackupRunResult | null>(null);
  const [base, setBase] = createSignal({
    enabled: false,
    endpoint: "",
    region: "us-east-1",
    bucket: "",
  });
  const [enabled, setEnabled] = createSignal(false);
  const [endpoint, setEndpoint] = createSignal("");
  const [region, setRegion] = createSignal("us-east-1");
  const [bucket, setBucket] = createSignal("");
  const [accessKeyId, setAccessKeyId] = createSignal("");
  const [secretAccessKey, setSecretAccessKey] = createSignal("");
  const [status, { refetch: refetchStatus }] = createResource(
    () => (props.isAdmin ? props.notebook.shortId : null),
    async (notebookId): Promise<BackupStatus> => {
      const res = await apiClient[":id"].snapshots.config.$get({ param: { id: notebookId } });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load snapshot settings."));
      return await res.json();
    },
  );
  const [logs, { refetch: refetchLogs }] = createResource(
    () => (props.isAdmin ? props.notebook.shortId : null),
    async (notebookId): Promise<LogTableEntry[]> => {
      const res = await apiClient[":id"].snapshots.logs.$get({
        param: { id: notebookId },
        query: { _: String(Date.now()) },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load snapshot logs."));
      return await res.json();
    },
  );

  createEffect(() => {
    const current = status();
    if (!current) return;
    const nextBase = backupDraftFromStatus(current);
    setBase(nextBase);
    setEnabled(nextBase.enabled);
    setEndpoint(nextBase.endpoint);
    setRegion(nextBase.region);
    setBucket(nextBase.bucket);
    setAccessKeyId("");
    setSecretAccessKey("");
  });

  const configMutation = mutations.create<BackupStatus, void>({
    mutation: async () => {
      const res = await apiClient[":id"].snapshots.config.$put({
        param: { id: props.notebook.shortId },
        json: {
          enabled: enabled(),
          endpoint: endpoint().trim(),
          region: region().trim() || "us-east-1",
          bucket: bucket().trim(),
          accessKeyId: accessKeyId().trim() || undefined,
          secretAccessKey: secretAccessKey().trim() || undefined,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update snapshot settings."));
      return await res.json();
    },
    onSuccess: () => {
      void refetchStatus();
      void refetchLogs();
    },
    onError: (error) => prompts.error(error.message),
  });

  const backupMutation = mutations.create<BackupRunResult, void>({
    mutation: async () => {
      const res = await apiClient[":id"].snapshots.run.$post({ param: { id: props.notebook.shortId } });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to upload snapshot."));
      return await res.json();
    },
    onSuccess: (result) => {
      setLastRun(result);
      void refetchStatus();
      void refetchLogs();
    },
    onError: (error) => {
      void prompts.error(error.message).finally(() => {
        void refetchLogs();
      });
    },
  });

  const missing = () => status()?.missing.join(", ") || "none";
  const dirty = () =>
    backupDraftIsDirty(
      { enabled: enabled(), endpoint: endpoint(), region: region(), bucket: bucket() },
      base(),
      accessKeyId(),
      secretAccessKey(),
    );
  const localLogEntries = (): LogTableEntry[] => {
    const run = lastRun();
    if (!run) return [];
    return [snapshotLogEntryFromRun(run, props.notebook.shortId)];
  };
  const logEntries = () => {
    const remote = logs() ?? [];
    const local = localLogEntries();
    if (local.length === 0) return remote;
    const localSha = String(local[0]?.metadata?.sha256 ?? "");
    return remote.some((entry) => String(entry.metadata?.sha256 ?? "") === localSha) ? remote : [...local, ...remote];
  };
  const logError = () => (logs.error instanceof Error ? logs.error.message : null);
  const showSnapshotLogs = () => enabled() || logEntries().length > 0 || logs.loading || !!logError();

  return (
    <div class="flex flex-col gap-4">
      <div class="paper p-4 text-sm text-secondary">
        Export this notebook as plain Markdown, raw attachments, and small JSON metadata files. Admin permission is required because the
        archive contains the full notebook.
      </div>
      <Show when={props.isAdmin} fallback={<p class="text-xs text-dimmed">Only notebook admins can download full exports.</p>}>
        <Link href={href()} download="" class="btn-primary btn-md self-start">
          <i class="ti ti-download" />
          Download ZIP export
        </Link>
        <div class="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold">S3 snapshots</h3>
              <p class="mt-1 text-xs text-dimmed">
                One-way ZIP snapshots for this notebook. Cloud admins manage the global schedule in /admin/notebooks.
              </p>
            </div>
            <SnapshotUploadAction
              enabled={enabled()}
              configured={!!status()?.configured}
              loading={backupMutation.loading()}
              disabled={status.loading || backupMutation.loading()}
              lastRun={lastRun()}
              onRun={() => backupMutation.mutate(undefined)}
            />
          </div>

          <SnapshotConfigFields
            notebookShortId={props.notebook.shortId}
            enabled={enabled}
            setEnabled={setEnabled}
            endpoint={endpoint}
            setEndpoint={setEndpoint}
            region={region}
            setRegion={setRegion}
            bucket={bucket}
            setBucket={setBucket}
            accessKeyId={accessKeyId}
            setAccessKeyId={setAccessKeyId}
            secretAccessKey={secretAccessKey}
            setSecretAccessKey={setSecretAccessKey}
            status={status()}
            missing={missing()}
            saving={configMutation.loading()}
            dirty={dirty()}
            onSave={() => configMutation.mutate(undefined)}
          />
        </div>

        <SnapshotLogsSection show={showSnapshotLogs()} entries={logEntries()} loading={logs.loading} error={logError()} />
      </Show>
    </div>
  );
}

// =============================================================================
// Permissions
// =============================================================================

function ApiKeysSection(props: { notebook: Notebook; apiKeys: ResourceApiKey[]; isAdmin: boolean }) {
  return (
    <Show when={props.isAdmin} fallback={<p class="text-xs text-dimmed">Only notebook admins can manage API keys.</p>}>
      <ResourceApiKeys
        title="API keys"
        description="Resource-bound keys for integrations that need access to this notebook."
        initialKeys={props.apiKeys}
        createKey={async (input) => {
          const res = await apiClient[":id"]["api-keys"].$post({
            param: { id: props.notebook.shortId },
            json: input,
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create API key."));
          return (await res.json()) as { credential: ResourceApiKey; token: string };
        }}
        revokeKey={async (credentialId) => {
          const res = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
            param: { id: props.notebook.shortId, credentialId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke API key."));
        }}
      />
    </Show>
  );
}

function PermissionsSection(props: { notebook: Notebook; accessEntries: AccessEntry[]; isAdmin: boolean }) {
  return (
    <Show when={props.isAdmin} fallback={<p class="text-xs text-dimmed">Only notebook admins can manage access.</p>}>
      <PermissionEditor
        initialEntries={props.accessEntries}
        canEdit
        grantAccess={async (principal, permission) => {
          const res = await apiClient[":id"].access.$post({
            param: { id: props.notebook.shortId },
            json: { principal, permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access."));
          return (await res.json()) as AccessEntry;
        }}
        updateAccess={async (accessId, permission) => {
          const res = await apiClient[":id"].access[":accessId"].$patch({
            param: { id: props.notebook.shortId, accessId },
            json: { permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update access."));
        }}
        revokeAccess={async (accessId) => {
          const res = await apiClient[":id"].access[":accessId"].$delete({
            param: { id: props.notebook.shortId, accessId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access."));
        }}
      />
    </Show>
  );
}

// =============================================================================
// Danger Zone
// =============================================================================

function DangerZone(props: { notebook: Notebook }) {
  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: props.notebook.shortId },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete notebook."));
    },
    onSuccess: () => navigateTo("/app/notebooks"),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.notebook.name}" and all its notes? This cannot be undone.`, {
      title: "Delete notebook",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) mutation.mutate(undefined);
  };

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed">This removes notes, versions, attachments, and access grants. It cannot be undone.</p>
      <button type="button" onClick={handleDelete} disabled={mutation.loading()} class="btn-danger btn-md self-start">
        {mutation.loading() ? (
          <>
            <i class="ti ti-loader-2 animate-spin" />
            Deleting
          </>
        ) : (
          <>
            <i class="ti ti-trash" />
            Delete notebook
          </>
        )}
      </button>
    </div>
  );
}

// =============================================================================
// Shared Body
// =============================================================================

function NotebookSettingsBody(props: Props & { bare?: boolean; close?: () => void }) {
  const [notebook, setNotebook] = createSignal(props.notebook);

  return (
    <div class={props.bare ? "flex h-[86vh] min-h-0 flex-col overflow-hidden" : "flex-1 overflow-y-auto"}>
      <div class={props.bare ? "min-h-0 flex-1 overflow-hidden" : "mx-auto flex h-full min-h-[70vh] max-w-5xl flex-col px-4 py-6"}>
        <SettingsModal
          title="Notebook settings"
          subtitle={notebook().name}
          icon={notebook().icon || "ti-notebook"}
          onClose={props.close}
          closeLabel="Close settings"
        >
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, icon, description, and default start page.">
            <GeneralSection notebook={notebook()} tree={props.tree} canWrite={props.canWrite} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
          <SettingsModal.Tab
            id="features"
            title="View & features"
            icon="ti ti-toggle-right"
            description="Navigation layout and notebook-level behavior."
          >
            <FeaturesSection notebook={notebook()} isAdmin={props.isAdmin} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
          <SettingsModal.Tab id="export" title="Export" icon="ti ti-download" description="Download a portable notebook archive.">
            <ExportSection notebook={notebook()} isAdmin={props.isAdmin} />
          </SettingsModal.Tab>
          {props.isAdmin && (
            <>
              <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
                <div class="flex flex-col gap-6">
                  <PermissionsSection notebook={notebook()} accessEntries={props.accessEntries} isAdmin={props.isAdmin} />
                  <ApiKeysSection notebook={notebook()} apiKeys={props.apiKeys} isAdmin={props.isAdmin} />
                </div>
              </SettingsModal.Tab>
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                description="Permanently delete this notebook and all of its notes."
                tone="danger"
              >
                <DangerZone notebook={notebook()} />
              </SettingsModal.Tab>
            </>
          )}
        </SettingsModal>
      </div>
    </div>
  );
}

export default function NotebookSettingsPanel(props: Props) {
  return <NotebookSettingsBody {...props} />;
}
