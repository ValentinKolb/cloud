import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  Checkbox,
  CodeDisplay,
  Disclosure,
  IconButtonLink,
  NumberInput,
  Placeholder,
  prompts,
  Select,
  StatusBadge,
  StructuredDataPreview,
  TextInput,
} from "@k2b/ui";
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { SelectedCapability } from "../catalog";
import { buildCapabilityCurl } from "../curl";
import { type CapabilityInvocationOutcome, readCapabilityOutcome } from "../invocation";
import { capabilityApiPath } from "../routes";
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
import CapabilityResultView from "./CapabilityResultView";

type Props = {
  selection: SelectedCapability;
  closeHref: string;
  initialAttemptKey: string;
};

type RunRequest = {
  input: Record<string, unknown>;
  idempotencyKey?: string;
};

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

function ResponsePanel(props: {
  run: ReturnType<typeof mutation.create<CapabilityInvocationOutcome, RunRequest>>;
  visible: () => boolean;
  selection: SelectedCapability;
}) {
  const outcome = () => props.run.data();
  return (
    <section class="detail-section">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="detail-section-label mb-1">Response</h3>
          <p class="text-xs text-dimmed">Validated result, metadata, and semantic links.</p>
        </div>
        <Show when={outcome()}>
          {(value) => <StatusBadge tone={value().ok ? "ok" : "error"} label={`${value().status} · ${Math.round(value().durationMs)} ms`} />}
        </Show>
      </div>
      <Show when={!props.run.loading()} fallback={<Placeholder state="loading" variant="panel" title="Running capability" />}>
        <Show
          when={props.visible() ? props.run.error() : null}
          fallback={
            <Show
              when={props.visible() ? outcome() : null}
              fallback={
                <Placeholder
                  variant="panel"
                  icon="ti ti-player-play"
                  title="Ready to run"
                  description="Complete the request and run the selected capability."
                />
              }
            >
              {(value) => <OutcomeContent outcome={value()} selection={props.selection} />}
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
    </section>
  );
}

function OutcomeContent(props: { outcome: CapabilityInvocationOutcome; selection: SelectedCapability }) {
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
      <CapabilityResultView
        selection={props.selection}
        data={props.outcome.result.data}
        refs={props.outcome.result.refs}
        page={props.outcome.result.page}
        links={props.outcome.result.links}
      />
    </div>
  );
}

function CapabilityRunner(props: Props) {
  const model = createSchemaEditorModel(props.selection.operation.inputSchema);
  const [editor, setEditor] = createSignal(createSchemaEditorState(model, props.selection.operation.inputSchema));
  const [submitted, setSubmitted] = createSignal(false);
  const [resultVisible, setResultVisible] = createSignal(false);
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
    setResultVisible(true);
    await run.mutate({ input: built.input, idempotencyKey: idempotencyKey() });
  };

  const reset = () => {
    run.abort();
    setAttemptKey(crypto.randomUUID());
    setSubmitted(false);
    setResultVisible(false);
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
    <div class="flex h-full min-h-0 flex-col">
      <header class="detail-header">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge tone="neutral" label={props.selection.kind === "query" ? "Query" : "Action"} />
            <code class="truncate text-xs text-dimmed">{`${props.selection.app.id}.${props.selection.operation.localId}`}</code>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={reset}>
              <i class="ti ti-refresh" aria-hidden="true" /> Reset
            </Button>
            <IconButtonLink href={props.closeHref} size="sm" label="Close capability details">
              <i class="ti ti-x" aria-hidden="true" />
            </IconButtonLink>
          </div>
        </div>
        <h2 class="mt-3 text-lg font-semibold text-primary">{props.selection.operation.title}</h2>
        <p class="mt-1 text-sm text-dimmed">{props.selection.operation.description}</p>
        <Show when={action()}>
          {(selectedAction) => (
            <div class="mt-3 flex flex-wrap gap-2">
              <StatusBadge
                tone={selectedAction().destructive ? "warning" : "neutral"}
                label={selectedAction().destructive ? "Destructive" : "Non-destructive"}
              />
              <StatusBadge
                tone={selectedAction().openWorld ? "warning" : "neutral"}
                label={selectedAction().openWorld ? "Open world" : "Cloud only"}
              />
              <StatusBadge tone="neutral" label={`Idempotency: ${selectedAction().idempotency}`} />
            </div>
          )}
        </Show>
      </header>

      <div class="detail-stack">
        <section class="detail-section">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="detail-section-label mb-1">Request</h3>
              <p class="text-xs text-dimmed">Input is validated before it is sent.</p>
            </div>
            <Button loading={run.loading()} loadingLabel="Running" onClick={() => void execute()}>
              <i class="ti ti-player-play" aria-hidden="true" /> Run
            </Button>
          </div>
          <RequestEditor model={model} state={editor} errors={fieldErrors} formError={formError} onStateChange={setEditor} />
          <div class="mt-4 flex flex-col gap-3">
            <Disclosure summary="Request as cURL" icon="ti ti-terminal-2" disabled={!curl()}>
              <Show when={curl()}>{(value) => <CodeDisplay code={value()} language="script" lineNumbers={false} />}</Show>
            </Disclosure>
            <Disclosure summary="Schemas" icon="ti ti-braces">
              <div class="grid gap-3">
                <StructuredDataPreview title="Input schema" data={props.selection.operation.inputSchema} maxRows={10} />
                <StructuredDataPreview title="Data schema" data={props.selection.operation.dataSchema} maxRows={10} />
              </div>
            </Disclosure>
          </div>
        </section>
        <ResponsePanel run={run} visible={resultVisible} selection={props.selection} />
      </div>
    </div>
  );
}

export default function CapabilitiesWorkspace(props: Props): JSX.Element {
  return <CapabilityRunner {...props} />;
}
