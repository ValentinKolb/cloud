import { mutation as mutations, query } from "@k2b/stdlib/solid";
import {
  Button,
  ButtonLink,
  CheckboxCard,
  LogEntriesTable,
  type LogTableEntry,
  NoticeCard,
  Placeholder,
  prompts,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
  TextInput,
} from "@k2b/ui";
import { type Accessor, createEffect, createSignal, onCleanup, type Setter, Show } from "solid-js";
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
        <Button
          variant="secondary"
          size="sm"
          disabled={props.disabled || !props.configured}
          onClick={props.onRun}
          loading={props.loading}
          loadingLabel="Uploading"
        >
          <Show when={!props.loading} fallback={<i class="ti ti-loader-2 animate-spin" />}>
            <i class="ti ti-cloud-upload" />
            Upload now
          </Show>
        </Button>
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
}) {
  return (
    <>
      <CheckboxCard
        label="Enable S3 snapshots"
        description="Writes latest.zip, a timestamped snapshot, and latest-manifest.json to your bucket."
        icon="ti ti-cloud-upload"
        value={props.enabled}
        onValueChange={props.setEnabled}
        disabled={props.saving}
      />

      <NoticeCard tone="info" icon={false}>
        Automatic schedule: <span class="font-mono text-primary">{props.status?.scheduleCron ?? "0 3 * * *"}</span>
        <span class="ml-2 text-dimmed">Cloud admins edit it in /admin/notebooks.</span>
      </NoticeCard>

      <Show when={props.enabled()}>
        <div class="grid gap-2">
          <TextInput
            label="Endpoint"
            value={props.endpoint}
            onValueChange={props.setEndpoint}
            placeholder="https://..."
            icon="ti ti-link"
            type="url"
          />
          <NoticeCard tone="info" icon={false} bodyClass="flex items-start gap-2">
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
          </NoticeCard>
          <div class="grid gap-2 md:grid-cols-2">
            <TextInput label="Region" value={props.region} onValueChange={props.setRegion} placeholder="eu-central-1" icon="ti ti-map" />
            <TextInput
              label="Bucket"
              value={props.bucket}
              onValueChange={props.setBucket}
              placeholder="my-notebook-backups"
              icon="ti ti-bucket"
            />
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <TextInput
              label="Access key ID"
              value={props.accessKeyId}
              onValueChange={props.setAccessKeyId}
              placeholder={props.status?.accessKeyIdSet ? "Stored - leave empty to keep" : ""}
              icon="ti ti-key"
            />
            <TextInput
              label="Secret access key"
              value={props.secretAccessKey}
              onValueChange={props.setSecretAccessKey}
              placeholder={props.status?.secretAccessKeySet ? "Stored - leave empty to keep" : ""}
              icon="ti ti-lock"
              password
            />
          </div>
          <NoticeCard tone="info" icon={false}>
            Target: <span class="font-medium text-primary">{props.status?.target ?? "not configured"}</span>
            <Show when={props.missing !== "none"}>
              <span class="ml-2 text-amber-600 dark:text-amber-300">Missing: {props.missing}</span>
            </Show>
          </NoticeCard>
        </div>
      </Show>
    </>
  );
}

function SnapshotLogsSection(props: { entries: LogTableEntry[]; loading: boolean; error: string | null }) {
  return (
    <Show
      when={!props.error}
      fallback={
        <NoticeCard tone="danger" icon={false} bodyClass="flex items-start gap-2">
          <i class="ti ti-alert-circle mt-0.5 shrink-0" />
          <span>{props.error}</span>
        </NoticeCard>
      }
    >
      <LogEntriesTable entries={props.entries} emptyMessage={props.loading ? "Loading snapshot logs..." : "No snapshot runs logged yet."} />
    </Show>
  );
}

export function ExportSection(props: { notebook: Notebook; onDirtyChange: (dirty: boolean) => void }) {
  const href = () => `/api/notebooks/${encodeURIComponent(props.notebook.id)}/export.zip`;
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
  const status = query.create({
    source: () => props.notebook.id,
    load: async (notebookId, { abortSignal }): Promise<BackupStatus> => {
      const res = await apiClient[":id"].snapshots.config.$get({ param: { id: notebookId } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load snapshot settings."));
      return await res.json();
    },
  });
  const logs = query.create({
    source: () => props.notebook.id,
    load: async (notebookId, { abortSignal }): Promise<LogTableEntry[]> => {
      const res = await apiClient[":id"].snapshots.logs.$get(
        {
          param: { id: notebookId },
          query: { _: String(Date.now()) },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load snapshot logs."));
      return await res.json();
    },
  });
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const [reconcileScope, setReconcileScope] = createSignal<boolean | null>(null);
  const [reconciling, setReconciling] = createSignal(false);

  const applyStatus = (current: BackupStatus) => {
    const nextBase = backupDraftFromStatus(current);
    setBase(nextBase);
    setEnabled(nextBase.enabled);
    setEndpoint(nextBase.endpoint);
    setRegion(nextBase.region);
    setBucket(nextBase.bucket);
    setAccessKeyId("");
    setSecretAccessKey("");
  };
  createEffect(() => {
    const current = status.data();
    if (current) applyStatus(current);
  });

  const reconcile = async (includeStatus = true) => {
    setReconcileError(null);
    setReconciling(true);
    try {
      await Promise.all(includeStatus ? [status.invalidate(), logs.invalidate()] : [logs.invalidate()]);
      setReconcileScope(null);
    } catch {
      setReconcileScope(includeStatus);
      setReconcileError("Saved, but the latest snapshot state could not be reloaded. Retry the read instead of saving again.");
    } finally {
      setReconciling(false);
    }
  };

  type ConfigIntent = {
    enabled: boolean;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  const configMutation = mutations.create<BackupStatus, ConfigIntent>({
    mutation: async (intent, { abortSignal }) => {
      const res = await apiClient[":id"].snapshots.config.$put(
        {
          param: { id: props.notebook.id },
          json: intent,
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update snapshot settings."));
      return await res.json();
    },
    onSuccess: (saved) => {
      applyStatus(saved);
      void reconcile(true);
    },
    onError: (error) => prompts.error(error.message),
  });

  const backupMutation = mutations.create<BackupRunResult, void>({
    mutation: async (_value, { abortSignal }) => {
      const res = await apiClient[":id"].snapshots.run.$post({ param: { id: props.notebook.id } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to upload snapshot."));
      return await res.json();
    },
    onSuccess: (result) => {
      setLastRun(result);
      void reconcile(false);
    },
    onError: (error) => {
      void prompts.error(error.message).finally(() => {
        void logs.refresh();
      });
    },
  });

  const missing = () => status.data()?.missing.join(", ") || "none";
  const dirty = () =>
    backupDraftIsDirty(
      { enabled: enabled(), endpoint: endpoint(), region: region(), bucket: bucket() },
      base(),
      accessKeyId(),
      secretAccessKey(),
    );
  createEffect(() => props.onDirtyChange(dirty()));
  onCleanup(() => {
    configMutation.abort();
    backupMutation.abort();
    props.onDirtyChange(false);
  });

  const discard = () => {
    const current = base();
    setEnabled(current.enabled);
    setEndpoint(current.endpoint);
    setRegion(current.region);
    setBucket(current.bucket);
    setAccessKeyId("");
    setSecretAccessKey("");
  };
  const localLogEntries = (): LogTableEntry[] => {
    const run = lastRun();
    if (!run) return [];
    return [snapshotLogEntryFromRun(run, props.notebook.id)];
  };
  const logEntries = () => {
    const remote = logs.data() ?? [];
    const local = localLogEntries();
    if (local.length === 0) return remote;
    const localSha = String(local[0]?.metadata?.sha256 ?? "");
    return remote.some((entry) => String(entry.metadata?.sha256 ?? "") === localSha) ? remote : [...local, ...remote];
  };
  const logError = () => logs.error()?.message ?? null;

  return (
    <>
      <SettingsGroup title="Portable export" description="Download a complete copy for transfer or offline storage.">
        <SettingsGroup.Action>
          <ButtonLink href={href()} download="" class="self-start">
            <i class="ti ti-download" />
            Download ZIP export
          </ButtonLink>
        </SettingsGroup.Action>
        <NoticeCard tone="info" icon={false}>
          Includes Markdown notes, raw attachments, and small JSON metadata files.
        </NoticeCard>
      </SettingsGroup>

      <SettingsGroup title="Automatic snapshots" description="Write one-way ZIP snapshots to S3-compatible object storage.">
        <SettingsGroup.Action>
          <SnapshotUploadAction
            enabled={enabled()}
            configured={!!status.data()?.configured}
            loading={backupMutation.loading()}
            disabled={status.loading() || backupMutation.loading() || reconciling()}
            lastRun={lastRun()}
            onRun={() => backupMutation.mutate(undefined)}
          />
        </SettingsGroup.Action>
        <Show when={!status.loading()} fallback={<Placeholder state="loading" variant="panel" title="Loading snapshot settings" />}>
          <Show
            when={status.data()}
            fallback={
              <Placeholder
                state="error"
                variant="panel"
                title="Could not load snapshot settings"
                description={status.error()?.message ?? "Snapshot settings could not be loaded."}
                action={
                  <Button type="button" variant="secondary" size="sm" onClick={() => void status.refresh()}>
                    <i class="ti ti-refresh" aria-hidden="true" />
                    Retry
                  </Button>
                }
              />
            }
          >
            <SnapshotConfigFields
              notebookShortId={props.notebook.id}
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
              status={status.data() ?? undefined}
              missing={missing()}
              saving={configMutation.loading() || reconciling()}
            />
          </Show>
        </Show>
      </SettingsGroup>

      <SettingsGroup title="Recent snapshots" description="Review the latest automatic and manually started uploads.">
        <SnapshotLogsSection entries={logEntries()} loading={logs.loading()} error={logError()} />
        <Show when={reconcileError()}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <NoticeCard tone="warning" icon={false} class="flex-1">
              {reconcileError()}
            </NoticeCard>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={reconciling()}
              onClick={() => void reconcile(reconcileScope() ?? true)}
            >
              Retry reload
            </Button>
          </div>
        </Show>
      </SettingsGroup>

      <SettingsModal.Footer>
        <SettingsPanelFooter
          changeCount={() => (dirty() ? 1 : 0)}
          loading={() => configMutation.loading() || reconciling()}
          onDiscard={discard}
          onSave={() =>
            configMutation.mutate({
              enabled: enabled(),
              endpoint: endpoint().trim(),
              region: region().trim() || "us-east-1",
              bucket: bucket().trim(),
              accessKeyId: accessKeyId().trim() || undefined,
              secretAccessKey: secretAccessKey().trim() || undefined,
            })
          }
        />
      </SettingsModal.Footer>
    </>
  );
}
