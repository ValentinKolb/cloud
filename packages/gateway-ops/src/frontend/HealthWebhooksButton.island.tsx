import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  CheckboxCard,
  DataTable,
  type DataTableColumn,
  dialogCore,
  NoticeCard,
  NumberInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@k2b/ui";
import { formatDateTime as fmtDateTime } from "@valentinkolb/cloud/shared";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import {
  createHealthWebhookQueries,
  type HealthApp,
  type HealthWebhook,
  type HealthWebhookInput,
  readHealthWebhookResponse,
  responseErrorMessage,
  type SettingEntry,
} from "./health-webhook-queries";

const defaultWebhook = (): HealthWebhookInput => ({
  name: "",
  url: "",
  method: "GET",
  enabled: true,
  scopeKind: "all",
  scopeAppIds: [],
  sendOn: ["error", "recovery"],
  minStatus: "error",
  repeatIntervalMs: 1_800_000,
  timeoutMs: 5000,
});

const toInput = (webhook?: HealthWebhook): HealthWebhookInput => ({
  ...(webhook ?? defaultWebhook()),
  name: webhook?.name ?? "",
  url: webhook?.url ?? "",
});

const toggle = <T extends string>(items: T[], item: T, checked: boolean) =>
  checked ? Array.from(new Set([...items, item])) : items.filter((value) => value !== item);

const appStatusDescription = (app: HealthApp) => {
  if (!app.online) return `offline · ${app.id}`;
  if (app.signals.length > 0) return `${app.signals.join(" · ")} · ${app.id}`;
  if (app.status === "warn") return `live, stale · ${app.id}`;
  return `live · ${app.id}`;
};

const fmtMinutes = (value: number) => `${Math.round(value / 60_000)} min`;

const statusClasses: Record<NonNullable<HealthWebhook["lastStatus"]> | "new", string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  error: "bg-red-500/10 text-red-500",
  new: "bg-zinc-500/10 text-dimmed",
};

const methodOptions = [
  {
    id: "GET",
    label: "GET ping",
    description: "Healthchecks.io style request without a JSON body.",
    icon: "ti ti-arrow-up-right",
  },
  {
    id: "POST",
    label: "POST JSON",
    description: "Send the current health report as JSON payload.",
    icon: "ti ti-json",
  },
];

const statusOptions = [
  { id: "ok", label: "OK", description: "Send even for healthy checks when the trigger matches.", icon: "ti ti-check" },
  { id: "warn", label: "Warning", description: "Send for warning or error states.", icon: "ti ti-alert-triangle" },
  { id: "error", label: "Error", description: "Send only when the scoped health status is error.", icon: "ti ti-alert-circle" },
];

const scopeOptions = [
  { id: "all", label: "All apps", description: "Evaluate every app known to the gateway.", icon: "ti ti-apps" },
  { id: "include", label: "Selected only", description: "Evaluate only the apps selected below.", icon: "ti ti-filter-check" },
  { id: "exclude", label: "Exclude selected", description: "Evaluate all apps except the selected ones.", icon: "ti ti-filter-x" },
];

const sendOptions = [
  { id: "ok", label: "OK", description: "Send when the scoped health state changes to OK.", icon: "ti ti-check" },
  { id: "warn", label: "Warning", description: "Send when scoped health becomes warning.", icon: "ti ti-alert-triangle" },
  { id: "error", label: "Error", description: "Send when the scoped health state changes to error.", icon: "ti ti-alert-circle" },
  { id: "recovery", label: "Recovery", description: "Send when a warning/error returns to OK.", icon: "ti ti-heartbeat" },
  { id: "every_check", label: "Every check", description: "Send on every scheduled evaluation.", icon: "ti ti-clock" },
] as const;

export const WebhookEditor = (props: { webhook?: HealthWebhook; apps: HealthApp[]; close: () => void; onSaved: () => Promise<void> }) => {
  const webhook = props.webhook;
  const initial = toInput(webhook);
  const [data, setData] = createSignal<HealthWebhookInput>(initial);
  const [persisted, setPersisted] = createSignal(false);
  const [reconciling, setReconciling] = createSignal(false);
  const [reconcileError, setReconcileError] = createSignal<Error | null>(null);
  let disposed = false;

  const save = mutation.create<HealthWebhook, HealthWebhookInput>({
    mutation: async (input, { abortSignal }) => {
      const response = webhook
        ? await apiClient.health.webhooks[":id"].$put({ param: { id: webhook.id }, json: input }, { init: { signal: abortSignal } })
        : await apiClient.health.webhooks.$post({ json: input }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Failed to save webhook"));
      return readHealthWebhookResponse(response);
    },
  });
  const busy = () => save.loading() || reconciling();
  const requestClose = () => {
    if (!busy()) props.close();
  };
  const reconcile = async () => {
    if (reconciling()) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      await props.onSaved();
    } catch (error) {
      if (!disposed) setReconcileError(error instanceof Error ? error : new Error(String(error)));
      if (!disposed) setReconciling(false);
      return;
    }
    if (disposed) return;
    setReconciling(false);
    props.close();
    toast.success("Webhook saved");
  };
  const submit = async () => {
    if (busy() || persisted()) return;
    const current = data();
    const input: HealthWebhookInput = {
      ...current,
      scopeAppIds: [...current.scopeAppIds],
      sendOn: [...current.sendOn],
    };
    await save.mutate(input);
    if (disposed) return;
    if (save.error()) {
      void prompts.error(save.error()!.message);
      return;
    }
    setPersisted(true);
    await reconcile();
  };
  onCleanup(() => {
    disposed = true;
    save.abort();
  });

  return (
    <form
      class="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PanelDialog>
        <PanelDialog.Header
          title={webhook ? "Edit Webhook" : "Add Webhook"}
          subtitle="Deliver gateway health alerts to an HTTP endpoint."
          icon="ti ti-heartbeat"
          close={requestClose}
        />
        <PanelDialog.Body>
          <CheckboxCard
            label="Enabled"
            description="Disabled webhooks stay configured but are skipped by scheduled checks."
            icon="ti ti-power"
            value={() => data().enabled}
            onValueChange={(enabled) => setData({ ...data(), enabled })}
          />
          <TextInput
            label="Name"
            description="Human-readable label shown on this alerts page."
            icon="ti ti-tag"
            value={() => data().name}
            onValueChange={(name) => setData({ ...data(), name })}
            required
          />

          <PanelDialog.Section title="Delivery" subtitle="Where and how this webhook is called." icon="ti ti-send">
            <div class="grid gap-3 md:grid-cols-2">
              <Select
                label="Method"
                description="Choose GET ping or POST JSON delivery."
                icon="ti ti-send"
                value={() => data().method}
                onValueChange={(method) => setData({ ...data(), method: method as "GET" | "POST" })}
                options={methodOptions}
              />
              <TextInput
                label="URL"
                description="Use an HTTP or HTTPS webhook endpoint."
                type="url"
                icon="ti ti-link"
                value={() => data().url}
                onValueChange={(url) => setData({ ...data(), url })}
                required
              />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <Select
                label="Minimum status"
                description="Lowest scoped health state to deliver."
                icon="ti ti-activity"
                value={() => data().minStatus}
                onValueChange={(minStatus) => setData({ ...data(), minStatus: minStatus as "ok" | "warn" | "error" })}
                options={statusOptions}
              />
              <NumberInput
                label="Repeat interval"
                description="Repeat unresolved warnings or errors."
                icon="ti ti-repeat"
                min={1}
                suffix="min"
                value={() => Math.round(data().repeatIntervalMs / 60_000)}
                onValueChange={(minutes) => setData({ ...data(), repeatIntervalMs: Math.max(1, minutes ?? 1) * 60_000 })}
              />
            </div>
          </PanelDialog.Section>

          <PanelDialog.Section title="Send when" subtitle="Choose trigger states and limit evaluation scope." icon="ti ti-bell-ringing">
            <div class="grid gap-2 md:grid-cols-2">
              <For each={sendOptions}>
                {(item) => (
                  <CheckboxCard
                    label={item.label}
                    description={item.description}
                    icon={item.icon}
                    value={() => data().sendOn.includes(item.id)}
                    onValueChange={(checked) => setData({ ...data(), sendOn: toggle(data().sendOn, item.id, checked) })}
                  />
                )}
              </For>
            </div>
            <Select
              label="Scope"
              description="Choose which registered apps this webhook evaluates."
              icon="ti ti-filter"
              value={() => data().scopeKind}
              onValueChange={(scopeKind) => setData({ ...data(), scopeKind: scopeKind as "all" | "include" | "exclude" })}
              options={scopeOptions}
            />
            <Show when={data().scopeKind !== "all"}>
              <div class="grid max-h-48 gap-2 overflow-y-auto md:grid-cols-2">
                <For each={props.apps}>
                  {(app) => (
                    <CheckboxCard
                      label={app.name}
                      description={appStatusDescription(app)}
                      icon={app.icon}
                      value={() => data().scopeAppIds.includes(app.id)}
                      onValueChange={(checked) => setData({ ...data(), scopeAppIds: toggle(data().scopeAppIds, app.id, checked) })}
                    />
                  )}
                </For>
              </div>
            </Show>
          </PanelDialog.Section>
          <Show when={reconcileError()}>
            {(error) => (
              <NoticeCard tone="danger" title="Webhook saved, but the list could not be refreshed" detail={error().message}>
                <Button type="button" size="sm" onClick={() => void reconcile()} disabled={reconciling()}>
                  Retry refresh
                </Button>
              </NoticeCard>
            )}
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Button type="button" variant="secondary" size="sm" onClick={requestClose} disabled={busy()}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy() || persisted()}>
            <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
            Save
          </Button>
        </PanelDialog.Footer>
      </PanelDialog>
    </form>
  );
};

const openWebhookEditor = (webhook: HealthWebhook | undefined, apps: HealthApp[], onSaved: () => Promise<void>) =>
  dialogCore.open<void>((close) => <WebhookEditor webhook={webhook} apps={apps} close={() => close()} onSaved={onSaved} />, {
    ...panelDialogOptions,
    cancelBehavior: "ignore",
  });

const ScheduleEditor = (props: { schedule: SettingEntry | undefined; close: () => void; onSaved: () => Promise<void> }) => {
  const initial = String(props.schedule?.value ?? props.schedule?.default ?? "*/5 * * * *");
  const [scheduleValue, setScheduleValue] = createSignal(initial);
  const [persisted, setPersisted] = createSignal(false);
  const [reconciling, setReconciling] = createSignal(false);
  const [reconcileError, setReconcileError] = createSignal<Error | null>(null);
  let disposed = false;

  const save = mutation.create<void, string>({
    mutation: async (value, { abortSignal }) => {
      const response = await apiClient.settings[":key{.+}"].$put(
        {
          param: { key: "gateway.health_check_schedule" },
          json: { value },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Failed to save schedule"));
    },
  });
  const busy = () => save.loading() || reconciling();
  const requestClose = () => {
    if (!busy()) props.close();
  };
  const reconcile = async () => {
    if (reconciling()) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      await props.onSaved();
    } catch (error) {
      if (!disposed) setReconcileError(error instanceof Error ? error : new Error(String(error)));
      if (!disposed) setReconciling(false);
      return;
    }
    if (disposed) return;
    setReconciling(false);
    props.close();
    toast.success("Schedule saved");
  };
  const submit = async () => {
    if (busy() || persisted()) return;
    const value = scheduleValue().trim() || initial;
    await save.mutate(value);
    if (disposed) return;
    if (save.error()) {
      void prompts.error(save.error()!.message);
      return;
    }
    setPersisted(true);
    await reconcile();
  };
  onCleanup(() => {
    disposed = true;
    save.abort();
  });

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextInput
        label="Schedule"
        description="Cron expression evaluated in app.timezone."
        icon="ti ti-calendar-time"
        value={scheduleValue}
        onValueChange={setScheduleValue}
        required
      />
      <Show when={reconcileError()}>
        {(error) => (
          <NoticeCard tone="danger" title="Schedule saved, but the settings could not be refreshed" detail={error().message}>
            <Button type="button" size="sm" onClick={() => void reconcile()} disabled={reconciling()}>
              Retry refresh
            </Button>
          </NoticeCard>
        )}
      </Show>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={requestClose} disabled={busy()}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy() || persisted()}>
          <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
          Save
        </Button>
      </div>
    </form>
  );
};

const openScheduleEditor = (schedule: SettingEntry | undefined, onSaved: () => Promise<void>) =>
  prompts.dialog<void>((close) => <ScheduleEditor schedule={schedule} close={() => close()} onSaved={onSaved} />, {
    title: "Check Schedule",
    icon: "ti ti-calendar-time",
    size: "small",
    cancelBehavior: "ignore",
  });

export default function HealthWebhooksPanel() {
  const { health, settings, webhooks } = createHealthWebhookQueries();
  const [confirming, setConfirming] = createSignal(false);
  let disposed = false;
  const schedule = () => settings.data()?.find((entry) => entry.key === "gateway.health_check_schedule");
  const queryBlocksWrite = (owner: {
    error: () => Error | null;
    loading: () => boolean;
    refreshing: () => boolean;
    stale: () => boolean;
  }) => owner.loading() || owner.refreshing() || owner.stale() || owner.error() !== null;
  const webhooksBlocked = () => queryBlocksWrite(webhooks);
  const scheduleBlocked = () => queryBlocksWrite(settings);
  const editorBlocked = () => webhooksBlocked() || queryBlocksWrite(health);

  const remove = mutation.create<void, { id: string; name: string }>({
    mutation: async (target, { abortSignal }) => {
      const response = await apiClient.health.webhooks[":id"].$delete({ param: { id: target.id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Failed to delete webhook"));
    },
  });

  const test = mutation.create<void, { id: string }>({
    mutation: async (target, { abortSignal }) => {
      const response = await apiClient.health.webhooks[":id"].test.$post({ param: { id: target.id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Failed to test webhook"));
    },
  });

  const removeWebhook = async (webhook: HealthWebhook) => {
    if (confirming() || remove.loading() || webhooksBlocked()) return;
    const target = { id: webhook.id, name: webhook.name };
    setConfirming(true);
    let confirmed = false;
    try {
      confirmed = (await prompts.confirm(`Delete "${target.name}"?`, { title: "Delete webhook", variant: "danger" })) === true;
    } finally {
      if (!disposed) setConfirming(false);
    }
    if (!confirmed || disposed || webhooksBlocked()) return;
    await remove.mutate(target);
    if (disposed) return;
    if (remove.error()) {
      void prompts.error(remove.error()!.message);
      return;
    }
    try {
      await webhooks.invalidate();
      if (!disposed) toast.success("Webhook deleted");
    } catch {
      if (!disposed) toast.error("Webhook deleted, but the list could not be refreshed.");
    }
  };
  const testWebhook = async (webhook: HealthWebhook) => {
    if (test.loading() || webhooksBlocked()) return;
    await test.mutate({ id: webhook.id });
    if (disposed) return;
    if (test.error()) void prompts.error(test.error()!.message);
    else toast.success("Webhook test submitted");
  };
  const openEditor = (webhook?: HealthWebhook) => {
    if (editorBlocked()) return;
    void openWebhookEditor(webhook, health.data()?.apps ?? [], () => webhooks.invalidate());
  };
  onCleanup(() => {
    disposed = true;
    remove.abort();
    test.abort();
  });

  const columns: DataTableColumn<HealthWebhook>[] = [
    { id: "name", header: "Webhook", value: (webhook) => webhook.name },
    { id: "status", header: "Status", value: (webhook) => webhook.lastStatus, headerClass: "text-center", cellClass: "text-center" },
    { id: "method", header: "Method", value: (webhook) => webhook.method },
    { id: "minimum", header: "Minimum", value: (webhook) => webhook.minStatus },
    { id: "repeat", header: "Repeat", value: (webhook) => webhook.repeatIntervalMs, headerClass: "text-right", cellClass: "text-right" },
    { id: "lastSent", header: "Last sent", value: (webhook) => webhook.lastSentAt, headerClass: "text-right", cellClass: "text-right" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "text-right",
      cellClass: "text-right whitespace-nowrap max-w-none",
    },
  ];

  return (
    <section class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0" style="view-transition-name: admin-webhooks-title">
          <h1 class="text-base font-semibold text-primary">Health Webhooks</h1>
          <p class="mt-1 text-xs text-dimmed">
            Current alert delivery is based on gateway health checks. The schedule is{" "}
            <code>{String(schedule()?.value ?? schedule()?.default ?? "*/5 * * * *")}</code>.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void openScheduleEditor(schedule(), () => settings.invalidate())}
            disabled={scheduleBlocked()}
          >
            <i class="ti ti-calendar-time" aria-hidden="true" />
            Schedule
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void openEditor()} disabled={editorBlocked()}>
            <i class="ti ti-plus" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      <Show when={settings.error()}>
        {(error) => (
          <NoticeCard tone="danger" title="Could not load the health-check schedule" detail={error().message}>
            <Button type="button" size="sm" onClick={() => void settings.refresh()} disabled={settings.refreshing()}>
              Retry
            </Button>
          </NoticeCard>
        )}
      </Show>
      <Show when={health.error()}>
        {(error) => (
          <NoticeCard tone="danger" title="Could not load registered app health" detail={error().message}>
            <Button type="button" size="sm" onClick={() => void health.refresh()} disabled={health.refreshing()}>
              Retry
            </Button>
          </NoticeCard>
        )}
      </Show>
      <Show when={webhooks.error()}>
        {(error) => (
          <NoticeCard tone="danger" title="Could not load health webhooks" detail={error().message}>
            <Button type="button" size="sm" onClick={() => void webhooks.refresh()} disabled={webhooks.refreshing()}>
              Retry
            </Button>
          </NoticeCard>
        )}
      </Show>

      <Show
        when={webhooks.data()}
        fallback={webhooks.error() ? null : <Placeholder state="loading" surface="paper" title="Loading webhooks..." />}
      >
        {(rows) => (
          <DataTable
            rows={rows()}
            columns={columns}
            getRowId={(webhook) => webhook.id}
            hoverRows
            highlightColumns={false}
            class="paper overflow-x-auto"
            tableClass="w-full text-sm"
            empty="No health webhooks configured."
            renderCell={({ row: webhook, col }) => {
              if (col.id === "name") {
                return (
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={`status-dot ${webhook.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      <span class="truncate text-xs font-medium text-primary">{webhook.name || "Untitled webhook"}</span>
                      <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-dimmed dark:bg-zinc-800">
                        {webhook.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <p class="mt-0.5 truncate text-[10px] text-dimmed">{webhook.url}</p>
                    <Show when={webhook.lastError}>
                      {(lastError) => <p class="mt-0.5 truncate text-[10px] text-red-500">{lastError()}</p>}
                    </Show>
                  </div>
                );
              }
              if (col.id === "status") {
                const status = webhook.lastStatus ?? "new";
                return <span class={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClasses[status]}`}>{status}</span>;
              }
              if (col.id === "method") return <span class="text-xs font-medium text-secondary">{webhook.method}</span>;
              if (col.id === "minimum") return <span class="text-xs capitalize text-dimmed">{webhook.minStatus}</span>;
              if (col.id === "repeat") return <span class="text-xs tabular-nums text-dimmed">{fmtMinutes(webhook.repeatIntervalMs)}</span>;
              if (col.id === "lastSent") return <span class="text-xs tabular-nums text-dimmed">{fmtDateTime(webhook.lastSentAt)}</span>;
              if (col.id === "actions") {
                return (
                  <div class="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void testWebhook(webhook)}
                      disabled={test.loading() || webhooksBlocked()}
                    >
                      Test
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void openEditor(webhook)} disabled={editorBlocked()}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void removeWebhook(webhook)}
                      disabled={remove.loading() || confirming() || webhooksBlocked()}
                    >
                      Delete
                    </Button>
                  </div>
                );
              }
              return "";
            }}
          />
        )}
      </Show>
    </section>
  );
}
