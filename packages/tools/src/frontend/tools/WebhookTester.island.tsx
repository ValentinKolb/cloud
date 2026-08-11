import { navigate } from "@k2b/ssr/nav";
import { mutation, timed } from "@k2b/stdlib/solid";
import {
  AppWorkspace,
  Button,
  CopyButton,
  DataTable,
  type DataTableColumn,
  type DataTableRenderCell,
  DescriptionList,
  DetailPanel,
  FilterChip,
  type FilterChipSection,
  IconButton,
  NoticeCard,
  prompts,
  Select,
  TextInput,
  toast,
} from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { assertOk, createWebhookQueries, type Endpoint, type WebhookLog } from "./webhook-queries";

type Mode = "receive" | "send";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type WebhookTesterInitialState = {
  mode: Mode;
  endpointId: string | null;
  method: Method | null;
  query: string;
  requestId: string | null;
};

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const DEFAULT_STATE: WebhookTesterInitialState = {
  mode: "receive",
  endpointId: null,
  method: null,
  query: "",
  requestId: null,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parseMethod = (value: string): Method | null => METHODS.find((method) => method === value.toUpperCase()) ?? null;

const MODE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "receive", label: "Receive", icon: "ti ti-inbox" },
      { value: "send", label: "Send", icon: "ti ti-send" },
    ],
  },
];

const METHOD_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "GET", label: "GET", icon: "ti ti-download" },
      { value: "POST", label: "POST", icon: "ti ti-upload" },
      { value: "PUT", label: "PUT", icon: "ti ti-refresh" },
      { value: "PATCH", label: "PATCH", icon: "ti ti-pencil" },
      { value: "DELETE", label: "DELETE", icon: "ti ti-trash" },
    ],
  },
];

export const parseWebhookTesterState = (url: URL): WebhookTesterInitialState => {
  const mode = url.searchParams.get("mode") === "send" ? "send" : "receive";
  return {
    mode,
    endpointId: UUID_RE.test(url.searchParams.get("endpoint") ?? "") ? url.searchParams.get("endpoint") : null,
    method: parseMethod(url.searchParams.get("method") ?? ""),
    query: url.searchParams.get("q") ?? "",
    requestId: url.searchParams.get("request") || null,
  };
};

const isWebhookLog = (value: unknown): value is WebhookLog =>
  Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string");

const assertWebhookLog = (value: unknown): WebhookLog => {
  if (isWebhookLog(value)) return value;
  throw new Error("Unexpected webhook response.");
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");
const shortBody = (value: string | null) => {
  if (!value) return "-";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
};

const parseJsonLike = (value: unknown): { ok: true; value: unknown } | { ok: false; value: string } => {
  if (value === null || value === undefined) return { ok: false, value: "-" };
  if (typeof value !== "string") return { ok: true, value };

  let current: unknown = value.trim();
  for (let i = 0; i < 2; i++) {
    if (typeof current !== "string") return { ok: true, value: current };
    const trimmed = current.trim();
    if (!trimmed || !["{", "[", '"'].includes(trimmed[0] ?? "")) break;
    try {
      current = JSON.parse(trimmed);
    } catch {
      break;
    }
  }
  return typeof current === "string" ? { ok: false, value: current || "-" } : { ok: true, value: current };
};

const stringifyBlock = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  return JSON.stringify(value, null, 2);
};

const formatPrettyValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
};

const parseHeaders = (raw: string): Record<string, string> => {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Headers must be a JSON object.");
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
};

const methodClass = (method: string) => {
  if (method === "GET") return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
  if (method === "POST") return "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300";
  if (method === "DELETE") return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
};

const statusClass = (status: number | null, error: string | null) => {
  if (error) return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  if (!status) return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  if (status >= 200 && status < 300) return "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300";
  if (status >= 400) return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
};

function RequestSearchInput(props: { value: string; onSearch: (value: string) => Promise<void> | void }) {
  const [value, setValue] = createSignal(props.value);
  const [focused, setFocused] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const debounce = timed.debounce((nextValue: string) => {
    void Promise.resolve(props.onSearch(nextValue)).finally(() => setPending(false));
  }, 200);

  createEffect(() => {
    if (!focused() && !debounce.isPending()) setValue(props.value);
  });

  return (
    <div onFocusIn={() => setFocused(true)} onFocusOut={() => setFocused(false)}>
      <TextInput
        type="search"
        icon="ti ti-search"
        placeholder="Search requests..."
        value={value}
        onValueChange={(next) => {
          setValue(next);
          setPending(true);
          debounce.debouncedFn(next);
        }}
        clearable
        suffix={pending() ? <i class="ti ti-loader-2 animate-spin text-zinc-400" /> : undefined}
      />
    </div>
  );
}

export default function WebhookTester(props: { initialState?: WebhookTesterInitialState; baseHref?: string }) {
  const [routeState, setRouteState] = createSignal<WebhookTesterInitialState>(props.initialState ?? DEFAULT_STATE);
  const [targetUrl, setTargetUrl] = createSignal("");
  const [sendMethod, setSendMethod] = createSignal<Method>("POST");
  const [headers, setHeaders] = createSignal('{\n  "content-type": "application/json"\n}');
  const [body, setBody] = createSignal('{\n  "hello": "world"\n}');

  const requestQuery = createMemo(
    () => ({
      mode: routeState().mode,
      endpointId: routeState().endpointId,
      method: routeState().method,
      query: routeState().query,
      requestId: null,
    }),
    undefined,
    {
      equals: (prev, next) =>
        prev.mode === next.mode && prev.endpointId === next.endpointId && prev.method === next.method && prev.query === next.query,
    },
  );

  const { endpoints: endpointsQuery, logs: logsQuery } = createWebhookQueries(requestQuery);
  const endpointOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "all", label: "All endpoints", icon: "ti ti-world" },
        ...(endpointsQuery.data() ?? []).map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.name,
          icon: "ti ti-webhook",
        })),
      ],
    },
  ];

  const selectedLog = createMemo(() => (logsQuery.data() ?? []).find((log) => log.id === routeState().requestId) ?? null);
  const baseUrl = () => props.baseHref ?? (typeof window === "undefined" ? "/tools/webhooks" : window.location.pathname);
  const absoluteEndpointUrl = (endpoint: Endpoint) => `${window.location.origin}${endpoint.urlPath}`;

  const buildHref = (state: WebhookTesterInitialState) => {
    const params = new URLSearchParams();
    if (state.mode !== "receive") params.set("mode", state.mode);
    if (state.endpointId && state.mode === "receive") params.set("endpoint", state.endpointId);
    if (state.method) params.set("method", state.method);
    if (state.query.trim()) params.set("q", state.query.trim());
    if (state.requestId) params.set("request", state.requestId);
    const query = params.toString();
    return `${baseUrl()}${query ? `?${query}` : ""}`;
  };

  let routeRevision = 0;
  const commitRoute = (patch: Partial<WebhookTesterInitialState>, options: { replace?: boolean } = { replace: true }) => {
    const next = { ...routeState(), ...patch };
    if (patch.mode && patch.mode !== routeState().mode) {
      next.endpointId = patch.mode === "receive" ? next.endpointId : null;
      next.requestId = null;
    }
    routeRevision += 1;
    setRouteState(next);
    navigate(buildHref(next), { replace: options.replace ?? true, scroll: "preserve" });
  };

  onMount(() => {
    const onPopState = () => {
      routeRevision += 1;
      setRouteState(parseWebhookTesterState(new URL(window.location.href)));
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  const createEndpointMutation = mutation.create<Endpoint, { name: string }>({
    mutation: async ({ name }, { abortSignal }) => {
      const response = await apiClient.webhooks.endpoints.$post({ json: { name } }, { init: { signal: abortSignal } });
      await assertOk(response);
      return (await response.json()) as Endpoint;
    },
  });

  const deleteEndpointMutation = mutation.create<Endpoint, Endpoint>({
    mutation: async (endpoint, { abortSignal }) => {
      const response = await apiClient.webhooks.endpoints[":endpointId"].$delete(
        { param: { endpointId: endpoint.id } },
        { init: { signal: abortSignal } },
      );
      await assertOk(response);
      return endpoint;
    },
  });

  const sendRequestMutation = mutation.create<WebhookLog, { url: string; method: Method; headers: Record<string, string>; body: string }>({
    mutation: async (intent, { abortSignal }) => {
      const response = await apiClient.webhooks.send.$post({ json: intent }, { init: { signal: abortSignal } });
      await assertOk(response);
      return assertWebhookLog(await response.json());
    },
  });

  const [reconciling, setReconciling] = createSignal(false);
  let disposed = false;
  let promptingCreate = false;
  const reconcile = async (tasks: Array<Promise<void>>) => {
    setReconciling(true);
    try {
      await Promise.all(tasks);
    } finally {
      if (!disposed) setReconciling(false);
    }
  };
  const writePending = () =>
    createEndpointMutation.loading() || deleteEndpointMutation.loading() || sendRequestMutation.loading() || reconciling();
  const writesBlocked = () =>
    writePending() ||
    endpointsQuery.loading() ||
    endpointsQuery.refreshing() ||
    logsQuery.loading() ||
    logsQuery.refreshing() ||
    Boolean(endpointsQuery.error() || logsQuery.error());

  onCleanup(() => {
    disposed = true;
    createEndpointMutation.abort();
    deleteEndpointMutation.abort();
    sendRequestMutation.abort();
  });

  const createEndpoint = async (nameInput: string) => {
    if (writesBlocked()) return;
    const name = nameInput.trim();
    if (!name) {
      toast.error("Enter an endpoint name.");
      return;
    }
    const startedAtRevision = routeRevision;
    await createEndpointMutation.mutate({ name });
    if (disposed) return;
    const error = createEndpointMutation.error();
    if (error) {
      toast.error(error.message || "Endpoint could not be created.");
      return;
    }
    const endpoint = createEndpointMutation.data()!;
    try {
      await reconcile([endpointsQuery.invalidate()]);
    } catch {
      if (disposed) return;
      toast.error("Endpoint created, but the endpoint list could not be refreshed.");
      return;
    }
    if (disposed) return;
    if (routeRevision === startedAtRevision) commitRoute({ mode: "receive", endpointId: endpoint.id, requestId: null });
    toast.success("Endpoint created.");
  };

  const openCreateEndpoint = async () => {
    if (writesBlocked() || promptingCreate) return;
    promptingCreate = true;
    try {
      const result = await prompts.form({
        title: "New endpoint",
        icon: "ti ti-webhook",
        fields: {
          name: { type: "text", label: "Name", required: true, placeholder: "e.g. Stripe test" },
        },
        confirmText: "Create",
      });
      if (disposed || !result) return;
      await createEndpoint(String(result.name ?? ""));
    } finally {
      promptingCreate = false;
    }
  };

  const deleteEndpoint = async (endpoint: Endpoint) => {
    if (writesBlocked()) return;
    const startedAtRevision = routeRevision;
    await deleteEndpointMutation.mutate(endpoint);
    if (disposed) return;
    const error = deleteEndpointMutation.error();
    if (error) {
      toast.error(error.message || "Endpoint could not be deleted.");
      return;
    }
    try {
      await reconcile([endpointsQuery.invalidate(), logsQuery.invalidate()]);
    } catch {
      if (disposed) return;
      toast.error("Endpoint deleted, but webhook data could not be refreshed.");
      return;
    }
    if (disposed) return;
    if (routeRevision === startedAtRevision && routeState().endpointId === endpoint.id) {
      commitRoute({ endpointId: null, requestId: null });
    }
    toast.success("Endpoint deleted.");
  };

  const sendRequest = async () => {
    if (writesBlocked()) return;
    try {
      const startedAtRevision = routeRevision;
      const intent = {
        url: targetUrl(),
        method: sendMethod(),
        headers: parseHeaders(headers()),
        body: body(),
      };
      await sendRequestMutation.mutate(intent);
      if (disposed) return;
      const error = sendRequestMutation.error();
      if (error) {
        toast.error(error.message || "Request failed.");
        return;
      }
      const log = sendRequestMutation.data()!;
      if (routeState().mode === "send") {
        try {
          await reconcile([logsQuery.invalidate()]);
        } catch {
          if (disposed) return;
          if (routeRevision === startedAtRevision) {
            toast.error("Request sent, but request logs could not be refreshed.");
            return;
          }
        }
      }
      if (disposed) return;
      if (routeRevision === startedAtRevision) commitRoute({ mode: "send", requestId: log.id });
      toast.success("Request sent.");
    } catch (error) {
      if (error instanceof Error) toast.error(error.message);
    }
  };

  const endpointColumns: DataTableColumn<Endpoint>[] = [
    { id: "name", header: "Name", value: "name", class: "min-w-[160px]" },
    { id: "url", header: "URL", value: (row) => absoluteEndpointUrl(row), class: "min-w-[260px]" },
    { id: "requests", header: "Requests", value: "requestCount", class: "w-24" },
    { id: "last", header: "Last request", value: (row) => formatDate(row.lastRequestAt), class: "min-w-[150px]" },
    { id: "actions", header: "", value: (row) => row.id, class: "w-14" },
  ];

  const logColumns: DataTableColumn<WebhookLog>[] = [
    { id: "method", header: "Method", value: "method", class: "w-20" },
    { id: "target", header: "Target", value: (row) => row.path || row.url, class: "min-w-[240px]" },
    { id: "status", header: "Status", value: (row) => row.responseStatus ?? row.error ?? "logged", class: "w-24" },
    { id: "contentType", header: "Content type", value: "requestContentType", class: "min-w-[140px]" },
    { id: "body", header: "Body", value: (row) => shortBody(row.requestBody), class: "min-w-[260px]" },
    { id: "created", header: "Time", value: (row) => formatDate(row.createdAt), class: "min-w-[160px]" },
  ];

  const renderEndpointCell: DataTableRenderCell<Endpoint> = (ctx) => {
    if (ctx.col.id === "url") {
      const url = absoluteEndpointUrl(ctx.row);
      return (
        <div class="flex items-center gap-2">
          <code class="truncate text-[11px]">{url}</code>
          <CopyButton text={url} variant="secondary" size="sm" class="shrink-0" />
        </div>
      );
    }
    if (ctx.col.id === "actions") {
      return (
        <IconButton
          label={`Delete endpoint ${ctx.row.name}`}
          variant="danger"
          size="sm"
          disabled={writesBlocked()}
          onClick={() => deleteEndpoint(ctx.row)}
        >
          <i class="ti ti-trash" aria-hidden="true" />
        </IconButton>
      );
    }
    return ctx.render(ctx.value);
  };

  const renderLogCell: DataTableRenderCell<WebhookLog> = (ctx) => {
    if (ctx.col.id === "method")
      return <span class={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${methodClass(ctx.row.method)}`}>{ctx.row.method}</span>;
    if (ctx.col.id === "status") {
      const label = ctx.row.error ? "Error" : ctx.row.responseStatus ? String(ctx.row.responseStatus) : "Logged";
      return (
        <span class={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(ctx.row.responseStatus, ctx.row.error)}`}>{label}</span>
      );
    }
    return ctx.render(ctx.value);
  };

  const hasActiveFilters = () => Boolean(routeState().endpointId || routeState().method || routeState().query.trim());
  const selectedMethodFilter = (): string[] => {
    const value = routeState().method;
    return value ? [value] : [];
  };
  const clearFilters = () => commitRoute({ endpointId: null, method: null, query: "", requestId: null });
  const totalLabel = () => {
    const count = logsQuery.data()?.length ?? 0;
    const base = count === 1 ? "1 request" : `${count} requests`;
    return logsQuery.loading() ? "Loading requests..." : hasActiveFilters() ? `${base} filtered` : base;
  };
  const retryReads = () => void Promise.all([endpointsQuery.refresh(), logsQuery.refresh()]).catch(() => undefined);
  const refreshLogs = () => void logsQuery.refresh().catch(() => undefined);

  return (
    <div class="flex min-h-0 min-w-0 flex-1">
      <AppWorkspace class="min-h-0 flex-1">
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarMobileTrigger label="Webhook Tester" />
          <AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarMobileItems scrollPreserveKey="webhook-tester-mobile-modes">
              <AppWorkspace.SidebarItem
                active={routeState().mode === "receive"}
                icon="ti ti-inbox"
                onClick={() => commitRoute({ mode: "receive", requestId: null }, { replace: false })}
              >
                Receive
              </AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem
                active={routeState().mode === "send"}
                icon="ti ti-send"
                onClick={() => commitRoute({ mode: "send", endpointId: null, requestId: null }, { replace: false })}
              >
                Send
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarMobileItems>
            <AppWorkspace.SidebarMobileBody scrollPreserveKey="webhook-tester-mobile-sidebar">
              <WebhookSidebarBody
                mode={routeState().mode}
                endpoints={endpointsQuery.data() ?? []}
                activeEndpointId={routeState().endpointId}
                onMode={(mode) => commitRoute({ mode, endpointId: mode === "send" ? null : routeState().endpointId, requestId: null })}
                onEndpoint={(endpointId) => commitRoute({ mode: "receive", endpointId, requestId: null })}
              />
            </AppWorkspace.SidebarMobileBody>
          </AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarDesktop>
            <AppWorkspace.SidebarBody scrollPreserveKey="webhook-tester-sidebar">
              <WebhookSidebarBody
                mode={routeState().mode}
                endpoints={endpointsQuery.data() ?? []}
                activeEndpointId={routeState().endpointId}
                onMode={(mode) => commitRoute({ mode, endpointId: mode === "send" ? null : routeState().endpointId, requestId: null })}
                onEndpoint={(endpointId) => commitRoute({ mode: "receive", endpointId, requestId: null })}
              />
            </AppWorkspace.SidebarBody>
          </AppWorkspace.SidebarDesktop>
        </AppWorkspace.Sidebar>

        <AppWorkspace.Content>
          <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
            <div class="flex min-h-0 flex-1 flex-col gap-2">
              <div class="flex items-center justify-between gap-3" style="view-transition-name: tools-webhook-title">
                <div class="min-w-0">
                  <h1 class="min-w-0 text-base font-semibold text-primary">Webhook tester</h1>
                  <p class="mt-0.5 text-xs text-dimmed">Create receive URLs, send test calls, and inspect stored request logs.</p>
                </div>
                <Show when={routeState().mode === "receive"}>
                  <Button
                    variant="secondary"
                    size="xs"
                    class="shrink-0"
                    disabled={writesBlocked()}
                    onClick={() => void openCreateEndpoint()}
                  >
                    <i class="ti ti-plus text-sm" />
                    Add
                  </Button>
                </Show>
              </div>

              <NoticeCard tone="warning" icon={false} bodyClass="flex items-start gap-2">
                <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
                <span>
                  Webhook tester data is stored on the server. Endpoint names, requests, headers, and bodies are logged for inspection.
                </span>
              </NoticeCard>

              <Show when={endpointsQuery.error() ?? logsQuery.error()}>
                {(error) => (
                  <NoticeCard tone="danger" title="Webhook data could not be refreshed" detail={error().message}>
                    <Button variant="secondary" size="sm" onClick={retryReads}>
                      Retry
                    </Button>
                  </NoticeCard>
                )}
              </Show>

              <Show
                when={routeState().mode === "receive"}
                fallback={
                  <SendPanel
                    blocked={writesBlocked()}
                    pending={writePending()}
                    targetUrl={targetUrl}
                    setTargetUrl={setTargetUrl}
                    method={sendMethod}
                    setMethod={setSendMethod}
                    headers={headers}
                    setHeaders={setHeaders}
                    body={body}
                    setBody={setBody}
                    onSend={sendRequest}
                  />
                }
              >
                <section class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <h2 class="text-sm font-semibold text-primary">Endpoints</h2>
                    <span class="text-xs text-dimmed">{endpointsQuery.data()?.length ?? 0} endpoints</span>
                  </div>
                  <DataTable
                    rows={endpointsQuery.data() ?? []}
                    columns={endpointColumns}
                    getRowId={(row) => row.id}
                    selectedRowId={routeState().endpointId}
                    onRowClick={(row) => commitRoute({ mode: "receive", endpointId: row.id, requestId: null })}
                    renderCell={renderEndpointCell}
                    empty="No endpoints yet."
                    density="compact"
                    class="max-h-48 overflow-auto"
                    scrollPreserveKey="webhook-endpoints-table"
                  />
                </section>
              </Show>

              <section class="flex min-h-0 flex-1 flex-col gap-2">
                <RequestSearchInput value={routeState().query} onSearch={(query) => commitRoute({ query, requestId: null })} />
                <div class="flex flex-wrap items-center gap-2">
                  <FilterChip
                    label="Mode"
                    icon="ti ti-arrows-exchange"
                    options={MODE_OPTIONS}
                    value={[routeState().mode]}
                    onValueChange={(value) => commitRoute({ mode: (value[0] ?? "receive") as Mode, requestId: null })}
                    defaultValue={["receive"]}
                  />
                  <Show when={routeState().mode === "receive"}>
                    <FilterChip
                      label="Webhook"
                      icon="ti ti-webhook"
                      options={endpointOptions()}
                      value={[routeState().endpointId ?? "all"]}
                      onValueChange={(value) =>
                        commitRoute({ endpointId: value[0] === "all" ? null : (value[0] ?? null), requestId: null })
                      }
                      isActive={Boolean(routeState().endpointId)}
                      defaultValue={["all"]}
                    />
                  </Show>
                  <FilterChip
                    label="Method"
                    icon="ti ti-code"
                    options={METHOD_OPTIONS}
                    value={selectedMethodFilter()}
                    onValueChange={(value) => commitRoute({ method: (value[0] as Method | undefined) ?? null, requestId: null })}
                  />
                  <Show when={hasActiveFilters()}>
                    <Button variant="secondary" size="sm" class="text-red-600 dark:text-red-400" onClick={clearFilters}>
                      <i class="ti ti-x" />
                      Clear
                    </Button>
                  </Show>
                  <span class="text-xs text-dimmed">{totalLabel()}</span>
                  <Button variant="secondary" size="sm" class="ml-auto" onClick={refreshLogs}>
                    <i class="ti ti-refresh" />
                    Refresh
                  </Button>
                </div>

                <DataTable
                  rows={logsQuery.data() ?? []}
                  columns={logColumns}
                  getRowId={(row) => row.id}
                  selectedRowId={routeState().requestId}
                  onRowClick={(row) => commitRoute({ requestId: row.id }, { replace: false })}
                  renderCell={renderLogCell}
                  empty={
                    routeState().mode === "receive" ? "No incoming requests match this view." : "No outgoing requests match this view."
                  }
                  density="compact"
                  fillHeight
                  class="paper flex-1 min-h-0 overflow-auto"
                  scrollPreserveKey="webhook-requests-table"
                />
              </section>
            </div>
          </AppWorkspace.Main>

          <AppWorkspace.Detail id="webhook-request" open={Boolean(selectedLog())} width="lg" viewTransitionName="webhook-request-detail">
            <Show when={selectedLog()}>
              {(log) => (
                <RequestDetail
                  log={log()}
                  endpoint={log().endpointId ? endpointsQuery.data()?.find((endpoint) => endpoint.id === log().endpointId) : null}
                  onClose={() => commitRoute({ requestId: null })}
                />
              )}
            </Show>
          </AppWorkspace.Detail>
        </AppWorkspace.Content>
      </AppWorkspace>
    </div>
  );
}

function WebhookSidebarBody(props: {
  mode: Mode;
  endpoints: Endpoint[];
  activeEndpointId: string | null;
  onMode: (mode: Mode) => void;
  onEndpoint: (endpointId: string | null) => void;
}) {
  return (
    <>
      <AppWorkspace.SidebarSection title="Requests">
        <AppWorkspace.SidebarItem icon="ti ti-inbox" active={props.mode === "receive"} onClick={() => props.onMode("receive")}>
          Receive
        </AppWorkspace.SidebarItem>
        <AppWorkspace.SidebarItem icon="ti ti-send" active={props.mode === "send"} onClick={() => props.onMode("send")}>
          Send
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarSection>

      <AppWorkspace.SidebarSection title="Webhooks">
        <AppWorkspace.SidebarItem
          icon="ti ti-world"
          active={props.mode === "receive" && !props.activeEndpointId}
          onClick={() => props.onEndpoint(null)}
          meta={props.endpoints.length}
        >
          All endpoints
        </AppWorkspace.SidebarItem>
        <For each={props.endpoints}>
          {(endpoint) => (
            <AppWorkspace.SidebarItem
              icon="ti ti-webhook"
              active={props.mode === "receive" && props.activeEndpointId === endpoint.id}
              onClick={() => props.onEndpoint(endpoint.id)}
              meta={endpoint.requestCount}
              title={endpoint.name}
            >
              {endpoint.name}
            </AppWorkspace.SidebarItem>
          )}
        </For>
      </AppWorkspace.SidebarSection>
    </>
  );
}

function SendPanel(props: {
  blocked: boolean;
  pending: boolean;
  targetUrl: () => string;
  setTargetUrl: (value: string) => void;
  method: () => Method;
  setMethod: (value: Method) => void;
  headers: () => string;
  setHeaders: (value: string) => void;
  body: () => string;
  setBody: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section class="paper p-4">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-primary">Send request</h2>
          <p class="mt-0.5 text-xs text-dimmed">Call an external webhook from the server and log the response.</p>
        </div>
        <Button
          size="sm"
          class="shrink-0"
          loading={props.pending}
          loadingLabel="Sending"
          disabled={props.blocked || !props.targetUrl().trim()}
          onClick={props.onSend}
        >
          <i class="ti ti-send text-sm" />
          Send
        </Button>
      </div>

      <div class="grid grid-cols-1 gap-2 lg:grid-cols-[10rem_1fr]">
        <Select label="Method" value={props.method} onValueChange={(value) => props.setMethod(value as Method)} options={METHODS} />
        <TextInput
          label="Target URL"
          type="url"
          placeholder="https://example.com/webhook"
          value={props.targetUrl}
          onValueChange={props.setTargetUrl}
        />
      </div>

      <div class="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-1">
          <TextInput label="Headers" multiline lines={7} value={props.headers} onValueChange={props.setHeaders} />
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <TextInput
            label="Body"
            multiline
            lines={7}
            value={props.body}
            onValueChange={props.setBody}
            disabled={props.method() === "GET"}
          />
        </div>
      </div>
    </section>
  );
}

export function RequestDetail(props: { log: WebhookLog; endpoint: Endpoint | null | undefined; onClose: () => void }) {
  const title = () => props.endpoint?.name ?? (props.log.direction === "incoming" ? "Incoming request" : "Outgoing request");
  const location = () => props.log.path || props.log.url;
  return (
    <DetailPanel>
      <DetailPanel.Header
        icon={props.log.direction === "incoming" ? "ti ti-inbox" : "ti ti-send"}
        title={title()}
        subtitle={
          <span class="flex min-w-0 items-center gap-1">
            <span class="shrink-0">{props.log.method}</span>
            <span class="shrink-0">·</span>
            <span class="min-w-0 truncate" title={location()}>
              {location()}
            </span>
          </span>
        }
        meta={<span title={formatDate(props.log.createdAt)}>{formatDate(props.log.createdAt)}</span>}
        actions={
          <>
            <CopyButton text={JSON.stringify(props.log, null, 2)} label="Copy JSON" variant="secondary" size="sm" />
            <IconButton label="Close request details" onClick={props.onClose}>
              <i class="ti ti-x" aria-hidden="true" />
            </IconButton>
          </>
        }
      />

      <DetailPanel.Body scrollPreserveKey={`webhook-request-detail-${props.log.id}`}>
        <DetailPanel.Summary title="Overview">
          <DescriptionList
            layout="rows"
            size="sm"
            items={[
              {
                term: "Status",
                description: props.log.error ? "Error" : props.log.responseStatus ? String(props.log.responseStatus) : "Logged",
              },
              { term: "Duration", description: props.log.durationMs === null ? "-" : `${props.log.durationMs} ms` },
              { term: "Content type", description: props.log.requestContentType ?? "-" },
              { term: "Query", description: props.log.query || "-" },
            ]}
          />
        </DetailPanel.Summary>

        <DetailPanel.Group label="Request data">
          <LogBlock title="Request headers" value={props.log.requestHeaders} />
          <LogBlock title="Request body" value={props.log.requestBody ?? "-"} />
        </DetailPanel.Group>

        <DetailPanel.Group label="Response data">
          <LogBlock title="Response headers" value={props.log.responseHeaders ?? "-"} />
          <LogBlock title="Response body" value={props.log.responseBody ?? props.log.error ?? "-"} />
        </DetailPanel.Group>
      </DetailPanel.Body>
    </DetailPanel>
  );
}

const LogBlock = (props: { title: string; value: unknown }) => {
  const [raw, setRaw] = createSignal(false);
  const parsed = () => parseJsonLike(props.value);
  const rawText = () => stringifyBlock(props.value);
  const prettyRows = () => {
    const data = parsed();
    if (!data.ok) return [];
    if (Array.isArray(data.value)) return data.value.map((value, index) => [String(index), value] as const);
    if (data.value && typeof data.value === "object") return Object.entries(data.value as Record<string, unknown>);
    return [["value", data.value] as const];
  };

  return (
    <DetailPanel.Section
      title={props.title}
      actions={
        <>
          <Button variant="secondary" size="xs" class="text-[11px]" onClick={() => setRaw(!raw())}>
            {raw() ? "Pretty" : "Raw"}
          </Button>
          <CopyButton text={rawText()} label="Copy" variant="secondary" size="xs" class="text-[11px]" />
        </>
      }
    >
      <Show
        when={!raw() && parsed().ok}
        fallback={<pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">{rawText()}</pre>}
      >
        <div class="max-h-80 overflow-auto rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900/60">
          <div class="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1.5 text-xs">
            <For each={prettyRows()}>
              {([key, value]) => {
                const isComplex = typeof value === "object" && value !== null;
                return (
                  <>
                    <span class="min-w-0 truncate font-medium text-dimmed" title={key}>
                      {key}
                    </span>
                    <span class={`min-w-0 whitespace-pre-wrap break-words text-secondary ${isComplex ? "font-mono text-[11px]" : ""}`}>
                      {formatPrettyValue(value)}
                    </span>
                  </>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </DetailPanel.Section>
  );
};
