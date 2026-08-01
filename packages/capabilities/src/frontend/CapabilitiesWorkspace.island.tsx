import { mutation } from "@k2b/stdlib/solid";
import {
  AppWorkspace,
  Button,
  Checkbox,
  CodeDisplay,
  Disclosure,
  LinkCard,
  NumberInput,
  Placeholder,
  prompts,
  Select,
  StatusBadge,
  StructuredDataPreview,
  TextInput,
} from "@k2b/ui";
import type { CapabilitySemanticLink } from "@valentinkolb/cloud/contracts";
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { CapabilityCatalogPage, SelectedCapability } from "../catalog";
import { buildCapabilityCurl } from "../curl";
import { type CapabilityInvocationOutcome, readCapabilityOutcome } from "../invocation";
import { type CapabilityKind, capabilityApiPath, capabilityHref } from "../routes";
import {
  buildCapabilityInput,
  createSchemaEditorModel,
  createSchemaEditorState,
  type EditorField,
  type EditorValue,
  type InputBuildResult,
  type SchemaEditorModel,
  type SchemaEditorState,
} from "../schema-editor";

type Props = {
  catalog: CapabilityCatalogPage;
  initialAttemptKey: string;
};

type RunRequest = {
  input: Record<string, unknown>;
  idempotencyKey?: string;
};

const operationHref = (selection: SelectedCapability, kind: CapabilityKind, capabilityId: string) =>
  capabilityHref({ appId: selection.app.id, kind, capabilityId });

const operationMatches = (query: string, title: string, id: string, description: string) => {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || `${title} ${id} ${description}`.toLocaleLowerCase().includes(needle);
};

function CapabilitySidebarContent(props: {
  catalog: CapabilityCatalogPage;
  selection?: SelectedCapability;
  query: () => string;
  onQueryChange: (value: string) => void;
}) {
  const apps = createMemo(() => props.catalog.apps.filter((app) => operationMatches(props.query(), app.name, app.id, app.description)));
  const queries = createMemo(() =>
    (props.selection?.manifest.queries ?? []).filter((operation) =>
      operationMatches(props.query(), operation.title, operation.localId, operation.description),
    ),
  );
  const actions = createMemo(() =>
    (props.selection?.manifest.actions ?? []).filter((operation) =>
      operationMatches(props.query(), operation.title, operation.localId, operation.description),
    ),
  );

  return (
    <>
      <AppWorkspace.SidebarBody class="flex flex-col gap-3">
        <TextInput
          type="search"
          value={props.query}
          onValueChange={props.onQueryChange}
          placeholder="Filter capabilities"
          aria-label="Filter capabilities"
          icon="ti ti-search"
          clearable
        />
        <AppWorkspace.SidebarSection title="Apps">
          <Show when={apps().length > 0} fallback={<p class="px-2 py-1 text-xs text-dimmed">No matching apps.</p>}>
            <For each={apps()}>
              {(app) => (
                <AppWorkspace.SidebarItem
                  href={capabilityHref({ appId: app.id })}
                  navigation="document"
                  active={props.selection?.app.id === app.id}
                  icon={app.icon || "ti ti-apps"}
                  title={app.description}
                >
                  {app.name}
                </AppWorkspace.SidebarItem>
              )}
            </For>
          </Show>
        </AppWorkspace.SidebarSection>
        <Show when={props.selection}>
          {(selection) => (
            <>
              <AppWorkspace.SidebarSection title="Queries">
                <For each={queries()}>
                  {(operation) => (
                    <AppWorkspace.SidebarItem
                      href={operationHref(selection(), "query", operation.localId)}
                      navigation="document"
                      active={selection().kind === "query" && selection().operation.localId === operation.localId}
                      icon="ti ti-search"
                      title={operation.description}
                    >
                      {operation.title}
                    </AppWorkspace.SidebarItem>
                  )}
                </For>
              </AppWorkspace.SidebarSection>
              <AppWorkspace.SidebarSection title="Actions">
                <For each={actions()}>
                  {(operation) => (
                    <AppWorkspace.SidebarItem
                      href={operationHref(selection(), "action", operation.localId)}
                      navigation="document"
                      active={selection().kind === "action" && selection().operation.localId === operation.localId}
                      icon="ti ti-bolt"
                      title={operation.description}
                    >
                      {operation.title}
                    </AppWorkspace.SidebarItem>
                  )}
                </For>
              </AppWorkspace.SidebarSection>
            </>
          )}
        </Show>
      </AppWorkspace.SidebarBody>
      <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
        <Show when={props.catalog.cursor}>
          <AppWorkspace.SidebarItem href={capabilityHref({})} navigation="document" icon="ti ti-chevrons-left">
            First page
          </AppWorkspace.SidebarItem>
        </Show>
        <Show when={props.catalog.nextCursor}>
          {(cursor) => (
            <AppWorkspace.SidebarItem href={capabilityHref({ cursor: cursor() })} navigation="document" icon="ti ti-chevron-right">
              More apps
            </AppWorkspace.SidebarItem>
          )}
        </Show>
        <AppWorkspace.SidebarItem href="/app/api-docs" navigation="document" icon="ti ti-book-2">
          API documentation
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarFooter>
    </>
  );
}

function FieldEditor(props: {
  field: EditorField;
  state: () => SchemaEditorState;
  error: () => string | undefined;
  onValueChange: (key: string, value: EditorValue) => void;
}) {
  const value = () => props.state().values[props.field.key];
  const common = {
    label: props.field.label,
    description: props.field.description,
    required: props.field.required,
  };

  return (
    <Show when={props.field.kind} keyed>
      {(kind) => {
        if (kind === "boolean") {
          return (
            <Checkbox
              {...common}
              value={() => Boolean(value())}
              error={props.error}
              onValueChange={(next) => props.onValueChange(props.field.key, next)}
            />
          );
        }
        if (kind === "number" || kind === "integer") {
          const field = props.field as Extract<EditorField, { kind: "number" | "integer" }>;
          return (
            <NumberInput
              {...common}
              value={() => (typeof value() === "number" ? (value() as number) : null)}
              error={props.error}
              min={field.minimum}
              max={field.maximum}
              decimalPlaces={kind === "integer" ? 0 : 12}
              step={kind === "integer" ? 1 : 0}
              showSteppers={false}
              onValueChange={(next) => props.onValueChange(field.key, next)}
            />
          );
        }
        if (kind === "enum") {
          const field = props.field as Extract<EditorField, { kind: "enum" }>;
          return (
            <Select
              {...common}
              value={() => (typeof value() === "string" ? (value() as string) : null)}
              error={props.error}
              options={field.options.map((option) => ({ value: option.value, label: option.label }))}
              placeholder="Select a value"
              onValueChange={(next) => props.onValueChange(field.key, next)}
            />
          );
        }
        if (kind === "array") {
          return (
            <TextInput
              {...common}
              value={() => (typeof value() === "string" ? (value() as string) : "")}
              error={props.error}
              multiline
              lines={4}
              monospace
              placeholder="One value per line"
              onValueChange={(next) => props.onValueChange(props.field.key, next)}
            />
          );
        }
        const field = props.field as Extract<EditorField, { kind: "string" }>;
        return (
          <TextInput
            {...common}
            value={() => (typeof value() === "string" ? (value() as string) : "")}
            error={props.error}
            type={field.format === "email" ? "email" : field.format === "uri" || field.format === "url" ? "url" : "text"}
            minLength={field.minLength}
            maxLength={field.maxLength}
            onValueChange={(next) => props.onValueChange(field.key, next)}
          />
        );
      }}
    </Show>
  );
}

function RequestEditor(props: {
  model: SchemaEditorModel;
  state: () => SchemaEditorState;
  errors: () => Record<string, string>;
  formError: () => string | undefined;
  onStateChange: (state: SchemaEditorState) => void;
}) {
  const updateValue = (key: string, value: EditorValue) =>
    props.onStateChange({ ...props.state(), values: { ...props.state().values, [key]: value } });

  return (
    <Show
      when={props.model.mode === "form" ? props.model : undefined}
      fallback={
        <TextInput
          label="Request JSON"
          description={props.model.mode === "json" ? props.model.reason : undefined}
          value={() => props.state().source}
          onValueChange={(source) => props.onStateChange({ ...props.state(), source })}
          error={props.formError}
          multiline
          monospace
          lines={14}
          spellcheck={false}
        />
      }
    >
      {(model) => (
        <div class="flex flex-col gap-4">
          <Show when={model().fields.length > 0} fallback={<p class="text-sm text-dimmed">This capability does not require input.</p>}>
            <For each={model().fields}>
              {(field) => (
                <FieldEditor field={field} state={props.state} error={() => props.errors()[field.key]} onValueChange={updateValue} />
              )}
            </For>
          </Show>
        </div>
      )}
    </Show>
  );
}

const linkIcon = (link: CapabilitySemanticLink) => {
  if (link.rel === "edit") return "ti ti-pencil";
  if (link.rel === "download") return "ti ti-download";
  if (link.rel === "preview") return "ti ti-eye";
  if (link.rel === "status") return "ti ti-activity";
  return "ti ti-external-link";
};

function ResponsePanel(props: { run: ReturnType<typeof mutation.create<CapabilityInvocationOutcome, RunRequest>> }) {
  const outcome = () => props.run.data();
  return (
    <div class="paper flex min-h-0 flex-col overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-primary">Response</h2>
          <p class="text-xs text-dimmed">Validated result, metadata, and semantic links.</p>
        </div>
        <Show when={outcome()}>
          {(value) => <StatusBadge tone={value().ok ? "ok" : "error"} label={`${value().status} · ${Math.round(value().durationMs)} ms`} />}
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <Show when={!props.run.loading()} fallback={<Placeholder state="loading" variant="panel" title="Running capability" />}>
          <Show
            when={props.run.error()}
            fallback={
              <Show
                when={outcome()}
                fallback={
                  <Placeholder
                    variant="panel"
                    icon="ti ti-player-play"
                    title="Ready to run"
                    description="Complete the request and run the selected capability."
                  />
                }
              >
                {(value) => <OutcomeContent outcome={value()} />}
              </Show>
            }
          >
            {(error) => (
              <Placeholder
                state="error"
                variant="panel"
                title="Could not reach the capability"
                description={error().message}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void props.run.retry()}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </Button>
                }
              />
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}

function OutcomeContent(props: { outcome: CapabilityInvocationOutcome }) {
  if (!props.outcome.ok) {
    return (
      <div class="flex flex-col gap-4">
        <Placeholder state="error" align="left" title={props.outcome.error.code} description={props.outcome.error.message} />
        <Show when={props.outcome.error.details}>{(details) => <StructuredDataPreview title="Details" data={details()} />}</Show>
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-4">
      <StructuredDataPreview title="Data" data={props.outcome.result.data} empty="The capability returned no data." />
      <Show when={props.outcome.result.refs?.length}>
        <StructuredDataPreview title="Resource references" data={props.outcome.result.refs} />
      </Show>
      <Show when={props.outcome.result.page}>{(page) => <StructuredDataPreview title="Page" data={page()} />}</Show>
      <Show when={props.outcome.result.links?.length}>
        <div class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Links</h3>
          <For each={props.outcome.result.links}>
            {(link) => (
              <LinkCard
                href={link.href}
                title={link.title ?? `${link.rel[0]!.toUpperCase()}${link.rel.slice(1)}`}
                description={link.href}
                icon={linkIcon(link)}
                color="blue"
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CapabilityRunner(props: { selection: SelectedCapability; initialAttemptKey: string }) {
  const model = createSchemaEditorModel(props.selection.operation.inputSchema);
  const [editor, setEditor] = createSignal(createSchemaEditorState(model, props.selection.operation.inputSchema));
  const [submitted, setSubmitted] = createSignal(false);
  const [attemptKey, setAttemptKey] = createSignal(props.initialAttemptKey);
  const input = createMemo<InputBuildResult>(() => buildCapabilityInput(model, editor()));
  const action = () => (props.selection.kind === "action" ? props.selection.operation : undefined);
  const idempotencyKey = () => (action()?.idempotency === "required" ? attemptKey() : undefined);

  const run = mutation.create<CapabilityInvocationOutcome, RunRequest>({
    mutation: async (request, context) => {
      const startedAt = performance.now();
      const url = capabilityApiPath({
        kind: props.selection.kind,
        appId: props.selection.app.id,
        capabilityId: props.selection.operation.localId,
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (request.idempotencyKey) headers["Idempotency-Key"] = request.idempotencyKey;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: request.input }),
        signal: context.abortSignal,
      });
      return readCapabilityOutcome(response, performance.now() - startedAt);
    },
  });
  onCleanup(() => run.abort());

  const execute = async () => {
    setSubmitted(true);
    const built = input();
    if (!built.ok) return;
    const selectedAction = action();
    if (selectedAction?.destructive) {
      const confirmed = await prompts.confirm(`Run “${props.selection.operation.title}”? This action is marked as destructive.`, {
        title: "Confirm destructive action",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    await run.mutate({ input: built.input, idempotencyKey: idempotencyKey() });
  };

  const newAttempt = () => {
    run.abort();
    setAttemptKey(crypto.randomUUID());
    setSubmitted(false);
    setEditor(createSchemaEditorState(model, props.selection.operation.inputSchema));
  };

  const curl = createMemo(() => {
    const built = input();
    if (!built.ok) return undefined;
    return buildCapabilityCurl({
      kind: props.selection.kind,
      appId: props.selection.app.id,
      capabilityId: props.selection.operation.localId,
      body: built.input,
      idempotencyKey: idempotencyKey(),
    });
  });
  const fieldErrors = () => {
    const built = input();
    return submitted() && !built.ok ? built.errors : {};
  };
  const formError = () => {
    const built = input();
    return submitted() && !built.ok ? built.formError : undefined;
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge tone="neutral" label={props.selection.kind === "query" ? "Query" : "Action"} />
            <code class="text-xs text-dimmed">{props.selection.operation.id}</code>
          </div>
          <h1 class="mt-2 text-xl font-semibold text-primary">{props.selection.operation.title}</h1>
          <p class="mt-1 max-w-3xl text-sm text-dimmed">{props.selection.operation.description}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={newAttempt}>
          <i class="ti ti-refresh" aria-hidden="true" /> New attempt
        </Button>
      </header>

      <Show when={action()}>
        {(selectedAction) => (
          <div class="flex flex-wrap gap-2">
            <StatusBadge
              tone={selectedAction().destructive ? "warning" : "neutral"}
              label={selectedAction().destructive ? "Destructive" : "Non-destructive"}
            />
            <StatusBadge
              tone={selectedAction().openWorld ? "warning" : "neutral"}
              label={selectedAction().openWorld ? "Open world" : "Cloud only"}
            />
            <StatusBadge tone="neutral" label={`Approval: ${selectedAction().approval}`} />
            <StatusBadge tone="neutral" label={`Idempotency: ${selectedAction().idempotency}`} />
          </div>
        )}
      </Show>

      <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
        <div class="paper flex min-h-0 flex-col overflow-hidden">
          <div class="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-primary">Request</h2>
              <p class="text-xs text-dimmed">Input is validated before it is sent.</p>
            </div>
            <Button loading={run.loading()} loadingLabel="Running" onClick={() => void execute()}>
              <i class="ti ti-player-play" aria-hidden="true" /> Run
            </Button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <RequestEditor model={model} state={editor} errors={fieldErrors} formError={formError} onStateChange={setEditor} />
            <div class="mt-4 flex flex-col gap-3">
              <Disclosure summary="Request as cURL" icon="ti ti-terminal-2" disabled={!curl()}>
                <Show when={curl()}>{(value) => <CodeDisplay code={value()} language="script" lineNumbers={false} />}</Show>
              </Disclosure>
              <Disclosure summary="Schemas" icon="ti ti-braces">
                <div class="grid gap-3 lg:grid-cols-2">
                  <StructuredDataPreview title="Input schema" data={props.selection.operation.inputSchema} maxRows={10} />
                  <StructuredDataPreview title="Result schema" data={props.selection.operation.resultSchema} maxRows={10} />
                </div>
              </Disclosure>
            </div>
          </div>
        </div>
        <ResponsePanel run={run} />
      </div>
    </div>
  );
}

export default function CapabilitiesWorkspace(props: Props): JSX.Element {
  const [query, setQuery] = createSignal("");
  const sidebar = () => (
    <CapabilitySidebarContent catalog={props.catalog} selection={props.catalog.selected} query={query} onQueryChange={setQuery} />
  );

  return (
    <AppWorkspace resizable={false}>
      <AppWorkspace.Sidebar resizable={false}>
        <AppWorkspace.SidebarHeader
          title="Capabilities"
          subtitle={props.catalog.selected?.app.name ?? `${props.catalog.apps.length} live apps`}
          icon="ti ti-api-app"
        />
        <AppWorkspace.SidebarMobile>{sidebar()}</AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>{sidebar()}</AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Content>
        <AppWorkspace.Main class="overflow-y-auto p-[var(--ui-space-shell)]">
          <Show
            when={!props.catalog.selectedAppUnavailable}
            fallback={
              <Placeholder
                state="error"
                variant="panel"
                title="Capability manifest unavailable"
                description="The app changed or disconnected while the catalog was loading. Refresh to try again."
                action={
                  <Button variant="secondary" onClick={() => window.location.reload()}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Refresh
                  </Button>
                }
              />
            }
          >
            <Show
              when={props.catalog.selected}
              fallback={
                <Placeholder
                  variant="panel"
                  icon="ti ti-api-app"
                  title="No live capabilities"
                  description="Apps with protocol v1 Queries or Actions appear here when they are registered."
                />
              }
            >
              {(selection) => <CapabilityRunner selection={selection()} initialAttemptKey={props.initialAttemptKey} />}
            </Show>
          </Show>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
