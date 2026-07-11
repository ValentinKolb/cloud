import {
  AppWorkspace,
  CopyButton,
  DataTable,
  type DataTableColumn,
  type DataTableRenderCell,
  FilterChip,
  type FilterChipSection,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigate } from "@valentinkolb/ssr/nav";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";

type Endpoint = {
  id: string;
  token: string;
  name: string;
  urlPath: string;
  requestCount: number;
  lastRequestAt: string | null;
  createdAt: string;
};

type WebhookLog = {
  id: string;
  endpointId: string | null;
  direction: "incoming" | "outgoing";
  method: string;
  url: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestContentType: string | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
};

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

const assertOk = async (response: Response): Promise<void> => {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
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

const buildLogQuery = (state: WebhookTesterInitialState) => {
  const query: { endpointId?: string; method?: Method; q?: string } = {};
  if (state.endpointId && state.mode === "receive") query.endpointId = state.endpointId;
  if (state.method) query.method = state.method;
  const q = state.query.trim();
  if (q) query.q = q;
  return query;
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
        onInput={(next) => {
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
  const [busy, setBusy] = createSignal(false);

  const [endpoints, { refetch: refetchEndpoints }] = createResource(async () => {
    const response = await apiClient.webhooks.endpoints.$get();
    await assertOk(response);
    const data = (await response.json()) as { items: Endpoint[] };
    return data.items;
  });

  const endpointOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "all", label: "All endpoints", icon: "ti ti-world" },
        ...(endpoints() ?? []).map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.name,
          icon: "ti ti-webhook",
        })),
      ],
    },
  ];

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

  const [logs, { refetch: refetchLogs }] = createResource(requestQuery, async (state) => {
    const query = buildLogQuery(state);
    const response =
      state.mode === "receive"
        ? await apiClient.webhooks["incoming-logs"].$get({ query })
        : await apiClient.webhooks["outgoing-logs"].$get({ query });
    await assertOk(response);
    const data = (await response.json()) as { items: WebhookLog[] };
    return data.items;
  });

  const selectedLog = createMemo(() => (logs() ?? []).find((log) => log.id === routeState().requestId) ?? null);
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

  const commitRoute = (patch: Partial<WebhookTesterInitialState>, options: { replace?: boolean } = { replace: true }) => {
    const next = { ...routeState(), ...patch };
    if (patch.mode && patch.mode !== routeState().mode) {
      next.endpointId = patch.mode === "receive" ? next.endpointId : null;
      next.requestId = null;
    }
    setRouteState(next);
    navigate(buildHref(next), { replace: options.replace ?? true, scroll: "preserve" });
  };

  onMount(() => {
    const onPopState = () => setRouteState(parseWebhookTesterState(new URL(window.location.href)));
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  const createEndpoint = async (nameInput: string) => {
    const name = nameInput.trim();
    if (!name) {
      toast.error("Enter an endpoint name.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiClient.webhooks.endpoints.$post({ json: { name } });
      await assertOk(response);
      const endpoint = (await response.json()) as Endpoint;
      await refetchEndpoints();
      commitRoute({ mode: "receive", endpointId: endpoint.id, requestId: null });
      toast.success("Endpoint created.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Endpoint could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const openCreateEndpoint = async () => {
    const result = await prompts.form({
      title: "New endpoint",
      icon: "ti ti-webhook",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Stripe test" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    await createEndpoint(String(result.name ?? ""));
  };

  const deleteEndpoint = async (endpoint: Endpoint) => {
    setBusy(true);
    try {
      const response = await apiClient.webhooks.endpoints[":endpointId"].$delete({ param: { endpointId: endpoint.id } });
      await assertOk(response);
      await refetchEndpoints();
      if (routeState().endpointId === endpoint.id) commitRoute({ endpointId: null, requestId: null });
      await refetchLogs();
      toast.success("Endpoint deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Endpoint could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async () => {
    setBusy(true);
    try {
      const response = await apiClient.webhooks.send.$post({
        json: {
          url: targetUrl(),
          method: sendMethod(),
          headers: parseHeaders(headers()),
          body: body(),
        },
      });
      await assertOk(response);
      const log = assertWebhookLog(await response.json());
      await refetchLogs();
      commitRoute({ mode: "send", requestId: log.id });
      toast.success("Request sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
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
          <CopyButton text={url} class="btn-input btn-sm shrink-0 !px-2" />
        </div>
      );
    }
    if (ctx.col.id === "actions") {
      return (
        <button type="button" class="btn-danger btn-sm" disabled={busy()} onClick={() => deleteEndpoint(ctx.row)}>
          <i class="ti ti-trash" />
        </button>
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
    const count = logs()?.length ?? 0;
    const base = count === 1 ? "1 request" : `${count} requests`;
    return logs.loading ? "Loading requests..." : hasActiveFilters() ? `${base} filtered` : base;
  };

  return (
    <AppWorkspace class="cloud-ui-soft min-h-0 flex-1">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader title="Webhook Tester" subtitle="Inspect HTTP calls" icon="ti ti-webhook" />
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
              endpoints={endpoints() ?? []}
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
              endpoints={endpoints() ?? []}
              activeEndpointId={routeState().endpointId}
              onMode={(mode) => commitRoute({ mode, endpointId: mode === "send" ? null : routeState().endpointId, requestId: null })}
              onEndpoint={(endpointId) => commitRoute({ mode: "receive", endpointId, requestId: null })}
            />
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main>
        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div class="flex items-center justify-between gap-3" style="view-transition-name: tools-webhook-title">
            <div class="min-w-0">
              <h1 class="min-w-0 text-base font-semibold text-primary">Webhook tester</h1>
              <p class="mt-0.5 text-xs text-dimmed">Create receive URLs, send test calls, and inspect stored request logs.</p>
            </div>
            <Show when={routeState().mode === "receive"}>
              <button type="button" class="btn-input btn-input-sm shrink-0" disabled={busy()} onClick={() => void openCreateEndpoint()}>
                <i class="ti ti-plus text-sm" />
                Add
              </button>
            </Show>
          </div>

          <div class="info-block-warning flex items-start gap-2">
            <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
            <span>
              Webhook tester data is stored on the server. Endpoint names, requests, headers, and bodies are logged for inspection.
            </span>
          </div>

          <Show
            when={routeState().mode === "receive"}
            fallback={
              <SendPanel
                busy={busy()}
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
                <span class="text-xs text-dimmed">{endpoints()?.length ?? 0} endpoints</span>
              </div>
              <DataTable
                rows={endpoints() ?? []}
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
                onChange={(value) => commitRoute({ mode: (value[0] ?? "receive") as Mode, requestId: null })}
                defaultValue={["receive"]}
              />
              <Show when={routeState().mode === "receive"}>
                <FilterChip
                  label="Webhook"
                  icon="ti ti-webhook"
                  options={endpointOptions()}
                  value={[routeState().endpointId ?? "all"]}
                  onChange={(value) => commitRoute({ endpointId: value[0] === "all" ? null : (value[0] ?? null), requestId: null })}
                  isActive={Boolean(routeState().endpointId)}
                  defaultValue={["all"]}
                />
              </Show>
              <FilterChip
                label="Method"
                icon="ti ti-code"
                options={METHOD_OPTIONS}
                value={selectedMethodFilter()}
                onChange={(value) => commitRoute({ method: (value[0] as Method | undefined) ?? null, requestId: null })}
              />
              <Show when={hasActiveFilters()}>
                <button type="button" class="btn-input btn-sm text-red-600 dark:text-red-400" onClick={clearFilters}>
                  <i class="ti ti-x" />
                  Clear
                </button>
              </Show>
              <span class="text-xs text-dimmed">{totalLabel()}</span>
              <button type="button" class="btn-input btn-sm ml-auto" onClick={() => refetchLogs()}>
                <i class="ti ti-refresh" />
                Refresh
              </button>
            </div>

            <DataTable
              rows={logs() ?? []}
              columns={logColumns}
              getRowId={(row) => row.id}
              selectedRowId={routeState().requestId}
              onRowClick={(row) => commitRoute({ requestId: row.id }, { replace: false })}
              renderCell={renderLogCell}
              empty={routeState().mode === "receive" ? "No incoming requests match this view." : "No outgoing requests match this view."}
              density="compact"
              fillHeight
              class="paper flex-1 min-h-0 overflow-auto"
              scrollPreserveKey="webhook-requests-table"
            />
          </section>
        </div>
      </AppWorkspace.Main>

      <AppWorkspace.Detail open={Boolean(selectedLog())} width="lg" viewTransitionName="webhook-request-detail">
        <Show when={selectedLog()}>
          {(log) => (
            <RequestDetail
              log={log()}
              endpoint={log().endpointId ? endpoints()?.find((endpoint) => endpoint.id === log().endpointId) : null}
              onClose={() => commitRoute({ requestId: null })}
            />
          )}
        </Show>
      </AppWorkspace.Detail>
    </AppWorkspace>
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
  busy: boolean;
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
        <button type="button" class="btn-primary btn-sm shrink-0" disabled={props.busy || !props.targetUrl().trim()} onClick={props.onSend}>
          <i class={`ti ${props.busy ? "ti-loader-2 animate-spin" : "ti-send"} text-sm`} />
          Send
        </button>
      </div>

      <div class="grid grid-cols-1 gap-2 lg:grid-cols-[10rem_1fr]">
        <Select label="Method" value={props.method} onChange={(value) => props.setMethod(value as Method)} options={METHODS} />
        <TextInput
          label="Target URL"
          type="url"
          placeholder="https://example.com/webhook"
          value={props.targetUrl}
          onInput={props.setTargetUrl}
        />
      </div>

      <div class="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-1">
          <TextInput label="Headers" multiline lines={7} value={props.headers} onInput={props.setHeaders} />
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <TextInput label="Body" multiline lines={7} value={props.body} onInput={props.setBody} disabled={props.method() === "GET"} />
        </div>
      </div>
    </section>
  );
}

function RequestDetail(props: { log: WebhookLog; endpoint: Endpoint | null | undefined; onClose: () => void }) {
  const title = () => props.endpoint?.name ?? (props.log.direction === "incoming" ? "Incoming request" : "Outgoing request");
  const location = () => props.log.path || props.log.url;
  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      <section class="paper p-4">
        <div class="flex min-w-0 items-start gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold text-primary">{title()}</h2>
            <p class="mt-1 flex min-w-0 items-center gap-1 text-xs text-dimmed">
              <span class="shrink-0">{props.log.method}</span>
              <span class="shrink-0">·</span>
              <span class="min-w-0 truncate" title={location()}>
                {location()}
              </span>
            </p>
            <p class="mt-0.5 truncate text-xs text-dimmed" title={formatDate(props.log.createdAt)}>
              {formatDate(props.log.createdAt)}
            </p>
          </div>
          <CopyButton text={JSON.stringify(props.log, null, 2)} label="Copy JSON" class="btn-input btn-sm shrink-0 !px-2" />
          <button type="button" class="btn-icon" aria-label="Close detail" onClick={props.onClose}>
            <i class="ti ti-x" />
          </button>
        </div>
      </section>

      <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`webhook-request-detail-${props.log.id}`}>
        <div class="flex flex-col gap-2">
          <div class="grid grid-cols-2 gap-2 text-xs">
            <DetailMetric
              label="Status"
              value={props.log.error ? "Error" : props.log.responseStatus ? String(props.log.responseStatus) : "Logged"}
            />
            <DetailMetric label="Duration" value={props.log.durationMs === null ? "-" : `${props.log.durationMs} ms`} />
            <DetailMetric label="Content type" value={props.log.requestContentType ?? "-"} />
            <DetailMetric label="Query" value={props.log.query || "-"} />
          </div>
          <LogBlock title="Request headers" value={props.log.requestHeaders} />
          <LogBlock title="Request body" value={props.log.requestBody ?? "-"} />
          <LogBlock title="Response headers" value={props.log.responseHeaders ?? "-"} />
          <LogBlock title="Response body" value={props.log.responseBody ?? props.log.error ?? "-"} />
        </div>
      </div>
    </div>
  );
}

const DetailMetric = (props: { label: string; value: string }) => (
  <div class="paper min-w-0 p-3">
    <p class="text-[10px] font-semibold uppercase tracking-wide text-dimmed">{props.label}</p>
    <p class="truncate text-xs text-primary">{props.value}</p>
  </div>
);

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
    <section class="paper p-4">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="min-w-0 truncate text-xs font-semibold text-dimmed">{props.title}</h3>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="btn-input btn-input-sm !h-7 !px-2 text-[11px]" onClick={() => setRaw(!raw())}>
            {raw() ? "Pretty" : "Raw"}
          </button>
          <CopyButton text={rawText()} label="Copy" class="btn-input btn-input-sm !h-7 !px-2 text-[11px]" />
        </div>
      </div>
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
    </section>
  );
};
