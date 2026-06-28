import { CheckboxCard, LogEntriesTable, prompts, TextInput, type LogTableEntry } from "@valentinkolb/cloud/ui";
import { Link } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { type Accessor, createEffect, createResource, createSignal, type Setter, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook } from "../sidebar/types";
import type { BackupRunResult, BackupStatus } from "./types";
import { backupDraftFromStatus, backupDraftIsDirty, readErrorMessage, snapshotLogEntryFromRun } from "./utils";

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

export function ExportSection(props: { notebook: Notebook; isAdmin: boolean }) {
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
