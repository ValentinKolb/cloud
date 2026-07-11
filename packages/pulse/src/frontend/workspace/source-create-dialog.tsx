import { dialogCore, NumberInput, PanelDialog, panelDialogOptions, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, Show, type Accessor } from "solid-js";
import { SOURCE_TYPE_OPTIONS } from "./helpers";
import type { CreateSourceInput, SourceCreateKind } from "./types";

type SourceCreateDialogOptions = {
  loading: Accessor<boolean>;
  createSource: (input: CreateSourceInput) => Promise<boolean>;
};

const sourceInfo =
  "After creating this source, add one or more labeled API keys from the source detail panel. Use them as Bearer tokens from ingestors, apps, automations, imports, or jobs.";

export const openSourceCreateDialog = (options: SourceCreateDialogOptions) =>
  dialogCore.open<void>((close) => {
    const [kind, setKind] = createSignal<SourceCreateKind>("http_ingest");
    const [name, setName] = createSignal("");
    const [endpointUrl, setEndpointUrl] = createSignal("");
    const [bearerToken, setBearerToken] = createSignal("");
    const [scrapeIntervalSeconds, setScrapeIntervalSeconds] = createSignal<number | null>(60);
    const title = () => (kind() === "http_ingest" ? "HTTP ingest" : "Metrics endpoint");

    const submit = async () => {
      const created = await options.createSource({
        kind: kind(),
        name: name(),
        endpointUrl: endpointUrl(),
        bearerToken: bearerToken(),
        scrapeIntervalSeconds: scrapeIntervalSeconds() ?? 60,
      });
      if (created) close();
    };

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
            title="New source"
            subtitle="Add one telemetry input for this Pulse base."
            icon="ti ti-plug-connected"
            close={close}
          />
          <PanelDialog.Body>
            <TextInput
              label="Name"
              description="Shown in source lists, dashboard filters, and setup examples."
              icon="ti ti-tag"
              value={name}
              onInput={setName}
              placeholder={kind() === "http_ingest" ? "Sales pipeline" : "Service metrics"}
            />

            <PanelDialog.Section title={title()} subtitle="Choose how Pulse should receive data." icon="ti ti-route">
              <SelectInput
                label="Type"
                description="Pick a scrape target or an ingest source that pushes data into Pulse."
                icon="ti ti-plug-connected"
                value={kind}
                onChange={(value) => setKind(value as SourceCreateKind)}
                options={SOURCE_TYPE_OPTIONS}
                required
              />
              <Show when={kind() === "metrics"}>
                <div class="grid gap-3 md:grid-cols-2">
                  <TextInput
                    label="Endpoint URL"
                    description="Pulse will scrape this /metrics endpoint on the configured interval."
                    type="url"
                    icon="ti ti-link"
                    value={endpointUrl}
                    onInput={setEndpointUrl}
                    placeholder="https://example.local/metrics"
                    required
                  />
                  <NumberInput
                    label="Scrape interval"
                    description="How often Pulse scrapes the endpoint."
                    icon="ti ti-refresh"
                    suffix="sec"
                    min={10}
                    max={86_400}
                    value={scrapeIntervalSeconds}
                    onInput={setScrapeIntervalSeconds}
                  />
                </div>
                <TextInput
                  label="Bearer token"
                  description="Optional. Stored encrypted by Pulse."
                  icon="ti ti-key"
                  value={bearerToken}
                  onInput={setBearerToken}
                  placeholder="Optional"
                  password
                />
              </Show>
              <Show when={kind() !== "metrics"}>
                <div class="info-block-info">
                  <div class="flex items-start gap-2">
                    <i class="ti ti-info-circle mt-0.5 shrink-0 text-blue-500" />
                    <p>{sourceInfo}</p>
                  </div>
                </div>
              </Show>
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <button type="button" class="btn-input btn-input-sm" onClick={() => close()} disabled={options.loading()}>
              Cancel
            </button>
            <button type="submit" class="btn-input btn-input-sm" disabled={options.loading() || (kind() === "metrics" && !endpointUrl().trim())}>
              <i class={`ti ${options.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-sm`} />
              Add
            </button>
          </PanelDialog.Footer>
        </PanelDialog>
      </form>
    );
  }, panelDialogOptions);
