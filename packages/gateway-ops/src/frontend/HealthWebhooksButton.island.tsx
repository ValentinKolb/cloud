import {
  CheckboxCard,
  DataTable,
  type DataTableColumn,
  dialogCore,
  NumberInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  SelectInput,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";

type SettingEntry = { key: string; value: unknown; default: unknown; description: string };

type HealthApp = {
  id: string;
  name: string;
  icon: string;
  status: "ok" | "warn" | "error";
  online: boolean;
};
type HealthWebhook = {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  enabled: boolean;
  scopeKind: "all" | "include" | "exclude";
  scopeAppIds: string[];
  sendOn: ("ok" | "warn" | "error" | "recovery" | "every_check")[];
  minStatus: "ok" | "warn" | "error";
  repeatIntervalMs: number;
  timeoutMs: number;
  lastStatus: "ok" | "warn" | "error" | null;
  lastSentAt: string | null;
  lastError: string | null;
};

type HealthWebhookInput = Omit<HealthWebhook, "id" | "lastStatus" | "lastSentAt" | "lastError">;

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const isHealthWebhook = (value: unknown): value is HealthWebhook =>
  Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string");

const readHealthWebhook = async (response: Response): Promise<HealthWebhook> => {
  const body = await response.json();
  if (isHealthWebhook(body)) return body;
  throw new Error("Unexpected webhook response.");
};

const loadWebhooks = async (): Promise<HealthWebhook[]> => {
  const response = await apiClient.health.webhooks.$get();
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to load health webhooks"));
  return response.json();
};

const loadSettings = async (): Promise<SettingEntry[]> => {
  const response = await apiClient.settings.$get();
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to load gateway settings"));
  return response.json();
};

const loadHealth = async (): Promise<{ apps: HealthApp[] }> => {
  const response = await apiClient.health.$get();
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to load gateway health"));
  return response.json();
};

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
  if (app.status === "warn") return `live, stale · ${app.id}`;
  return `live · ${app.id}`;
};

const fmtDateTime = (value: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

const WebhookEditor = (props: { webhook?: HealthWebhook; apps: HealthApp[]; close: () => void; onSaved: () => void }) => {
  const webhook = props.webhook;
  const initial = toInput(webhook);
  const [data, setData] = createSignal<HealthWebhookInput>(initial);

  const save = mutation.create<HealthWebhook, void>({
    mutation: async () => {
      const input = data();
      const response = webhook
        ? await apiClient.health.webhooks[":id"].$put({ param: { id: webhook.id }, json: input })
        : await apiClient.health.webhooks.$post({ json: input });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to save webhook"));
      return readHealthWebhook(response);
    },
    onSuccess: () => {
      toast.success("Webhook saved");
      props.onSaved();
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <form
      class="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void save.mutate();
      }}
    >
      <PanelDialog>
        <PanelDialog.Header
          title={webhook ? "Edit Webhook" : "Add Webhook"}
          subtitle="Deliver gateway health alerts to an HTTP endpoint."
          icon="ti ti-heartbeat"
          close={props.close}
        />
        <PanelDialog.Body>
          <CheckboxCard
            label="Enabled"
            description="Disabled webhooks stay configured but are skipped by scheduled checks."
            icon="ti ti-power"
            value={() => data().enabled}
            onChange={(enabled) => setData({ ...data(), enabled })}
          />
          <TextInput
            label="Name"
            description="Human-readable label shown on this alerts page."
            icon="ti ti-tag"
            value={() => data().name}
            onInput={(name) => setData({ ...data(), name })}
            required
          />

          <PanelDialog.Section title="Delivery" subtitle="Where and how this webhook is called." icon="ti ti-send">
            <div class="grid gap-3 md:grid-cols-2">
              <SelectInput
                label="Method"
                description="Choose GET ping or POST JSON delivery."
                icon="ti ti-send"
                value={() => data().method}
                onChange={(method) => setData({ ...data(), method: method as "GET" | "POST" })}
                options={methodOptions}
              />
              <TextInput
                label="URL"
                description="Use an HTTP or HTTPS webhook endpoint."
                type="url"
                icon="ti ti-link"
                value={() => data().url}
                onInput={(url) => setData({ ...data(), url })}
                required
              />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <SelectInput
                label="Minimum status"
                description="Lowest scoped health state to deliver."
                icon="ti ti-activity"
                value={() => data().minStatus}
                onChange={(minStatus) => setData({ ...data(), minStatus: minStatus as "ok" | "warn" | "error" })}
                options={statusOptions}
              />
              <NumberInput
                label="Repeat interval"
                description="Repeat unresolved warnings or errors."
                icon="ti ti-repeat"
                min={1}
                suffix="min"
                value={() => Math.round(data().repeatIntervalMs / 60_000)}
                onInput={(minutes) => setData({ ...data(), repeatIntervalMs: Math.max(1, minutes ?? 1) * 60_000 })}
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
                    onChange={(checked) => setData({ ...data(), sendOn: toggle(data().sendOn, item.id, checked) })}
                  />
                )}
              </For>
            </div>
            <SelectInput
              label="Scope"
              description="Choose which registered apps this webhook evaluates."
              icon="ti ti-filter"
              value={() => data().scopeKind}
              onChange={(scopeKind) => setData({ ...data(), scopeKind: scopeKind as "all" | "include" | "exclude" })}
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
                      onChange={(checked) => setData({ ...data(), scopeAppIds: toggle(data().scopeAppIds, app.id, checked) })}
                    />
                  )}
                </For>
              </div>
            </Show>
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button type="button" class="btn-input btn-input-sm" onClick={props.close} disabled={save.loading()}>
            Cancel
          </button>
          <button type="submit" class="btn-input btn-input-sm" disabled={save.loading()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
            Save
          </button>
        </PanelDialog.Footer>
      </PanelDialog>
    </form>
  );
};

const openWebhookEditor = (webhook: HealthWebhook | undefined, apps: HealthApp[], onSaved: () => void) =>
  dialogCore.open<void>((close) => <WebhookEditor webhook={webhook} apps={apps} close={() => close()} onSaved={onSaved} />, panelDialogOptions);

const ScheduleEditor = (props: { schedule: SettingEntry | undefined; close: () => void; onSaved: () => void }) => {
  const initial = String(props.schedule?.value ?? props.schedule?.default ?? "*/5 * * * *");
  const [scheduleValue, setScheduleValue] = createSignal(initial);

  const save = mutation.create<void, void>({
    mutation: async () => {
      const value = scheduleValue().trim() || initial;
      const response = await apiClient.settings[":key{.+}"].$put({
        param: { key: "gateway.health_check_schedule" },
        json: { value },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to save schedule"));
    },
    onSuccess: () => {
      toast.success("Schedule saved");
      props.onSaved();
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <form
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save.mutate();
      }}
    >
      <TextInput
        label="Schedule"
        description="Cron expression evaluated in app.timezone."
        icon="ti ti-calendar-time"
        value={scheduleValue}
        onInput={setScheduleValue}
        required
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={props.close} disabled={save.loading()}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm" disabled={save.loading()}>
          <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
          Save
        </button>
      </div>
    </form>
  );
};

const openScheduleEditor = (schedule: SettingEntry | undefined, onSaved: () => void) =>
  prompts.dialog<void>((close) => <ScheduleEditor schedule={schedule} close={() => close()} onSaved={onSaved} />, {
    title: "Check Schedule",
    icon: "ti ti-calendar-time",
    size: "small",
  });

export default function HealthWebhooksPanel() {
  const [webhooks, { refetch }] = createResource(loadWebhooks);
  const [settings, { refetch: refetchSettings }] = createResource(loadSettings);
  const [health] = createResource(loadHealth);
  const schedule = () => settings()?.find((entry) => entry.key === "gateway.health_check_schedule");

  const remove = mutation.create<void, HealthWebhook>({
    mutation: async (webhook) => {
      const confirmed = await prompts.confirm(`Delete "${webhook.name}"?`, { title: "Delete webhook", variant: "danger" });
      if (!confirmed) return;
      const response = await apiClient.health.webhooks[":id"].$delete({ param: { id: webhook.id } });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to delete webhook"));
    },
    onSuccess: () => {
      toast.success("Webhook deleted");
      void refetch();
    },
    onError: (error) => prompts.error(error.message),
  });

  const test = mutation.create<void, HealthWebhook>({
    mutation: async (webhook) => {
      const response = await apiClient.health.webhooks[":id"].test.$post({ param: { id: webhook.id } });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to test webhook"));
    },
    onSuccess: () => toast.success("Webhook test submitted"),
    onError: (error) => prompts.error(error.message),
  });

  const openEditor = (webhook?: HealthWebhook) =>
    openWebhookEditor(webhook, health()?.apps ?? [], () => {
      void refetch();
    });

  const columns: DataTableColumn<HealthWebhook>[] = [
    { id: "name", header: "Webhook", value: (webhook) => webhook.name },
    { id: "status", header: "Status", value: (webhook) => webhook.lastStatus, headerClass: "text-center", cellClass: "text-center" },
    { id: "method", header: "Method", value: (webhook) => webhook.method },
    { id: "minimum", header: "Minimum", value: (webhook) => webhook.minStatus },
    { id: "repeat", header: "Repeat", value: (webhook) => webhook.repeatIntervalMs, headerClass: "text-right", cellClass: "text-right" },
    { id: "lastSent", header: "Last sent", value: (webhook) => webhook.lastSentAt, headerClass: "text-right", cellClass: "text-right" },
    { id: "actions", header: <span class="sr-only">Actions</span>, headerClass: "text-right", cellClass: "text-right whitespace-nowrap max-w-none" },
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
          <button
            type="button"
            class="btn-input btn-input-sm"
            onClick={() => openScheduleEditor(schedule(), () => void refetchSettings())}
          >
            <i class="ti ti-calendar-time text-sm" />
            Schedule
          </button>
          <button type="button" class="btn-input btn-input-sm" onClick={() => void openEditor()}>
            <i class="ti ti-plus text-sm" />
            Add
          </button>
        </div>
      </div>

      <Show when={!webhooks.loading} fallback={<div class="paper p-4 text-sm text-dimmed">Loading webhooks...</div>}>
        <DataTable
          rows={webhooks() ?? []}
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
                  <button type="button" class="btn-simple btn-sm" onClick={() => void test.mutate(webhook)} disabled={test.loading()}>
                    Test
                  </button>
                  <button type="button" class="btn-simple btn-sm" onClick={() => void openEditor(webhook)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-red-500"
                    onClick={() => void remove.mutate(webhook)}
                    disabled={remove.loading()}
                  >
                    Delete
                  </button>
                </div>
              );
            }
            return "";
          }}
        />
      </Show>
    </section>
  );
}
