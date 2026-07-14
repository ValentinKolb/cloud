import {
  DataTable,
  ResourceApiKeys,
  Tooltip,
  type DataTableColumn,
  type ResourceApiKey,
  type ResourceApiKeysProps,
} from "@valentinkolb/cloud/ui";
import { Show, type JSX } from "solid-js";
import type { PulseSource, PulseSourceScrape } from "../../contracts";
import DetailHero from "./DetailHero";
import { compactDateWithDelta, type PulseDateContext } from "./helpers";

type Props = {
  source: PulseSource;
  published: { resources: number; metricVariants: number; states: number; events: number };
  origin: string;
  dateContext: PulseDateContext;
  loading: boolean;
  scrapes: PulseSourceScrape[];
  apiKeys: ResourceApiKey[];
  scrapeColumns: DataTableColumn<PulseSourceScrape>[];
  renderScrapeCell: (scrape: PulseSourceScrape, col: DataTableColumn<PulseSourceScrape>) => JSX.Element;
  copySetupText: (text: string, label: string) => void;
  openSourceResources: (source: PulseSource) => void;
  editSource: (source: PulseSource) => void | Promise<void>;
  toggleSource: (source: PulseSource) => void | Promise<void>;
  close: () => void;
  scrape: (source: PulseSource) => void | Promise<void>;
  removeSource: (source: PulseSource) => void | Promise<void>;
  createApiKey: ResourceApiKeysProps["createKey"];
  revokeApiKey: ResourceApiKeysProps["revokeKey"];
};

const httpIngestExample = (source: PulseSource, origin: string) =>
  source.kind === "http_ingest"
    ? `curl -fsS -X POST ${origin}/api/pulse/ingest \\
  -H "Authorization: Bearer <api-key>" \\
  -H "Content-Type: application/json" \\
  --data '{
    "metrics": [
      { "name": "orders.created", "value": 1, "type": "counter", "dimensions": { "channel": "webshop" } },
      { "name": "solar.output_watts", "value": 4200, "type": "gauge", "unit": "W", "dimensions": { "site": "warehouse" } }
    ],
    "events": [
      { "kind": "order.created", "dimensions": { "channel": "webshop" }, "payload": { "orderId": "demo-1001" } },
      { "kind": "import.finished", "dimensions": { "dataset": "inventory" }, "payload": { "rows": 128 } }
    ],
    "states": [
      { "key": "checkout.enabled", "value": true },
      { "key": "integration.online", "value": true, "dimensions": { "integration": "webshop" } }
    ]
  }'`
    : "";

export default function SourceDetailView(props: Props) {
  const renderCodeSection = (params: { title: string; code: string }) => (
    <section class="detail-section">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-secondary">{params.title}</h3>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="btn-input btn-input-sm" onClick={() => props.copySetupText(params.code, "Command copied")}>
            <i class="ti ti-copy" /> Copy
          </button>
        </div>
      </div>
      <pre class="max-h-72 overflow-auto rounded-lg bg-zinc-100 p-3 text-[11px] leading-relaxed text-secondary dark:bg-zinc-900/80">
        <code>{params.code}</code>
      </pre>
    </section>
  );

  const httpExample = () => httpIngestExample(props.source, props.origin);

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <DetailHero
        eyebrow="Source"
        title={props.source.name}
        icon="ti ti-database-share"
        description={
          <>
            {props.source.kind}
            {props.source.enabled ? " · enabled" : " · paused"}
            {props.source.bearerTokenConfigured ? " · bearer auth" : ""}
          </>
        }
        actions={
          <Tooltip content="Close details">
            <button type="button" class="icon-btn" aria-label="Close source details" onClick={props.close}>
              <i class="ti ti-x" />
            </button>
          </Tooltip>
        }
        quickActions={
          <>
            <button type="button" class="btn-secondary btn-sm" onClick={() => void props.editSource(props.source)}>
              <i class="ti ti-pencil" /> Edit
            </button>
            <button type="button" class="btn-secondary btn-sm" onClick={() => void props.toggleSource(props.source)}>
              <i class={`ti ${props.source.enabled ? "ti-player-pause" : "ti-player-play"}`} />
              {props.source.enabled ? "Pause" : "Resume"}
            </button>
            <button type="button" class="btn-secondary btn-sm" onClick={() => props.openSourceResources(props.source)}>
              <i class="ti ti-cube" /> Resources
            </button>
            <Show when={props.source.kind === "metrics"}>
              <button
                type="button"
                class="btn-secondary btn-sm"
                disabled={props.loading || !props.source.enabled}
                onClick={() => void props.scrape(props.source)}
              >
                <i class="ti ti-refresh" /> Scrape
              </button>
            </Show>
          </>
        }
      />

      <div class="detail-stack">
        <section class="detail-section">
          <h3 class="detail-section-label">Status</h3>
          <div class="detail-row">
            <i class="ti ti-clock detail-row-icon app-accent-text" />
            <span class="detail-row-label">Last seen</span>
            <span>{props.source.lastSeenAt ? compactDateWithDelta(props.source.lastSeenAt, props.dateContext) : "Waiting"}</span>
          </div>
          <Show when={props.source.kind === "metrics"}>
            <div class="detail-row">
              <i class="ti ti-refresh detail-row-icon text-emerald-600" />
              <span class="detail-row-label">Interval</span>
              <span>{props.source.scrapeIntervalSeconds ?? 60}s</span>
            </div>
          </Show>
          <Show when={props.source.lastError}>
            {(message) => (
              <div class="detail-row text-red-600 dark:text-red-300">
                <i class="ti ti-alert-circle detail-row-icon" />
                <span class="detail-row-label">Error</span>
                <span class="break-all">{message()}</span>
              </div>
            )}
          </Show>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-label">Published</h3>
          <button
            type="button"
            class="detail-row w-full text-left transition hover:app-accent-text"
            onClick={() => props.openSourceResources(props.source)}
          >
            <i class="ti ti-cube detail-row-icon app-accent-text" />
            <span class="detail-row-label">Resources</span>
            <span>{props.published.resources.toLocaleString()}</span>
          </button>
          <div class="detail-row">
            <i class="ti ti-chart-dots detail-row-icon text-emerald-600" />
            <span class="detail-row-label">Metrics</span>
            <span>{props.published.metricVariants.toLocaleString()} variants</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-toggle-right detail-row-icon text-violet-500" />
            <span class="detail-row-label">States</span>
            <span>{props.published.states.toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <i class="ti ti-bolt detail-row-icon text-amber-500" />
            <span class="detail-row-label">Events</span>
            <span>{props.published.events.toLocaleString()} recent</span>
          </div>
        </section>

        <Show when={props.source.kind === "metrics"}>
          <section class="overflow-hidden">
            <DataTable
              rows={props.scrapes}
              columns={props.scrapeColumns}
              getRowId={(scrape) => scrape.id}
              density="compact"
              class="max-h-72 overflow-auto"
              empty="No scrapes recorded yet."
              renderCell={({ row: scrape, col }) => props.renderScrapeCell(scrape, col)}
            />
          </section>
        </Show>

        <section class="detail-section">
          <h3 class="detail-section-label">Target</h3>
          <Show when={props.source.kind === "metrics"} fallback={<p class="text-xs text-secondary">{props.source.kind} ingest endpoint</p>}>
            <p class="break-all text-xs text-secondary">{props.source.endpointUrl ?? "No endpoint"}</p>
          </Show>
        </section>

        <Show when={props.source.kind === "http_ingest"}>
          <section>
            <ResourceApiKeys
              title="API keys"
              description="Create a labeled key for each importer, server, or job that pushes data into this source."
              initialKeys={props.apiKeys}
              permissionOptions={[
                {
                  value: "write",
                  label: "Ingest",
                  description: "Push metrics, events, and states into this source.",
                  icon: "ti ti-database-import",
                },
              ]}
              createKey={props.createApiKey}
              revokeKey={props.revokeApiKey}
            />
          </section>
        </Show>

        <Show when={httpExample()}>{(command) => renderCodeSection({ title: "HTTP ingest example", code: command() })}</Show>
      </div>

      <div class="flex flex-wrap items-center gap-2 p-3">
        <Show when={props.source.kind === "http_ingest"}>
          <span class="text-xs text-dimmed">Use a source API key as Bearer token.</span>
        </Show>
        <button
          type="button"
          class="btn-danger btn-sm ml-auto"
          disabled={props.loading}
          onClick={() => void props.removeSource(props.source)}
        >
          <i class="ti ti-trash" /> Remove
        </button>
      </div>
    </div>
  );
}
