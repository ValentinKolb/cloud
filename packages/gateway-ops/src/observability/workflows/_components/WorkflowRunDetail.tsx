import { formatDurationMs, formatNumber, formatRelative } from "@valentinkolb/cloud/shared";
import { DataPanel, DataTable, type DataTableColumn, NoticeCard, StatusBadge, StructuredDataPreview } from "@valentinkolb/cloud/ui";
import type { WorkflowRunState } from "@valentinkolb/cloud/workflows";
import type { WorkflowRunDetail, WorkflowStepSummary } from "@valentinkolb/cloud/workflows/store";
import type { JSX } from "solid-js";
import { type WorkflowsFilterState, workflowsFilter } from "../filters";
import { EFFECT_TONE, RUN_LABEL, RUN_TONE, runErrorSummary, STEP_TONE, stepDetail } from "../presentation";
import WorkflowRunActions from "./WorkflowRunActions.island";

const columns: DataTableColumn<WorkflowStepSummary>[] = [
  { id: "step", header: "Step", cellClass: "min-w-[160px]" },
  { id: "action", header: "Action" },
  { id: "state", header: "State" },
  { id: "effect", header: "Effect" },
  { id: "details", header: "Details", cellClass: "min-w-[220px]" },
  { id: "attempts", header: "Attempts", align: "right" },
  { id: "duration", header: "Duration", align: "right" },
];

const attentionStepFor = (detail: WorkflowRunDetail) =>
  detail.steps.find((step) => step.state === "needs_attention" && (step.effectState === "executing" || step.effectState === "ambiguous"));

const RunSteps = (props: { steps: WorkflowStepSummary[] }) => (
  <DataTable
    rows={props.steps}
    columns={columns}
    getRowId={(step) => step.stepKey}
    density="compact"
    class="overflow-x-auto"
    empty="This run has not recorded a step yet."
    renderCell={({ row, col, value, render }) => {
      if (col.id === "step") return <span class="font-mono text-xs">{row.stepKey}</span>;
      if (col.id === "action") return <span class="text-secondary">{row.action ?? row.kind}</span>;
      if (col.id === "state") return <StatusBadge tone={STEP_TONE[row.state] ?? "neutral"} label={row.state} variant="dot" />;
      if (col.id === "effect")
        return row.effectState ? (
          <StatusBadge tone={EFFECT_TONE[row.effectState] ?? "neutral"} label={row.effectState} variant="dot" />
        ) : (
          <span class="text-dimmed">—</span>
        );
      if (col.id === "details")
        return (
          <span class="block max-w-[360px] truncate text-secondary" title={stepDetail(row)}>
            {stepDetail(row)}
          </span>
        );
      if (col.id === "attempts") return <span class="text-dimmed">{row.attempt + 1}</span>;
      if (col.id === "duration") return <span class="text-secondary">{formatDurationMs(row.durationMs)}</span>;
      return render(value);
    }}
  />
);

const RunFact = (props: { label: string; children: JSX.Element }) => (
  <div class="min-w-0">
    <dt class="text-[10px] uppercase tracking-wider text-dimmed">{props.label}</dt>
    <dd class="mt-0.5 truncate text-xs text-primary">{props.children}</dd>
  </div>
);

const ChildLinks = (props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) => {
  if (!Object.values(props.detail.children).some((count) => count > 0)) return null;
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-dimmed">Children</span>
      {(Object.entries(props.detail.children) as [WorkflowRunState, number][])
        .filter(([, count]) => count > 0)
        .map(([childState, count]) => (
          <a
            href={workflowsFilter.build(props.state, {
              view: "runs",
              run: "",
              parent: props.detail.id,
              state: childState,
              page: 1,
            })}
          >
            <StatusBadge
              tone={RUN_TONE[childState]}
              label={`${formatNumber(count)} ${RUN_LABEL[childState].toLowerCase()}`}
              variant="dot"
            />
          </a>
        ))}
    </div>
  );
};

const RunOverview = (props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) => (
  <section>
    <h3 class="text-xs font-semibold text-primary">Run overview</h3>
    <dl class="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <RunFact label="Trigger">{props.detail.eventType ?? "Direct invocation"}</RunFact>
      <RunFact label="Occurred">{formatRelative(props.detail.occurredAt)}</RunFact>
      <RunFact label="Start lag">{formatDurationMs(props.detail.startLagMs)}</RunFact>
      <RunFact label="Duration">{formatDurationMs(props.detail.durationMs)}</RunFact>
      {props.detail.parentRunId ? (
        <RunFact label="Parent run">
          <a
            class="font-mono text-[11px] hover:underline"
            href={workflowsFilter.build(props.state, { view: "runs", run: props.detail.parentRunId, parent: "" })}
          >
            {props.detail.parentRunId}
          </a>
        </RunFact>
      ) : null}
    </dl>
    <div class="mt-3">
      <ChildLinks detail={props.detail} state={props.state} />
    </div>
  </section>
);

const Disclosure = (props: { title: string; description: string; children: JSX.Element }) => (
  <details class="group rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)]">
    <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5">
      <span class="min-w-0">
        <span class="block text-xs font-medium text-primary">{props.title}</span>
        <span class="block truncate text-[11px] text-dimmed">{props.description}</span>
      </span>
      <i class="ti ti-chevron-down shrink-0 text-xs text-dimmed transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div class="px-3 pb-3">{props.children}</div>
  </details>
);

const RunPayloads = (props: { detail: WorkflowRunDetail }) => (
  <Disclosure title="Inputs and outputs" description="Invocation data, result and event payload">
    <div class="grid gap-3 lg:grid-cols-2">
      <StructuredDataPreview title="Inputs" data={props.detail.inputs} empty="No inputs." />
      <StructuredDataPreview title="Result" data={props.detail.result} empty={props.detail.resultMessage ?? "No result."} />
      {props.detail.eventData ? <StructuredDataPreview title="Event payload" data={props.detail.eventData} class="lg:col-span-2" /> : null}
    </div>
  </Disclosure>
);

const DurableExecutionData = (props: { detail: WorkflowRunDetail }) => (
  <Disclosure title="Technical details" description="Identifiers, budgets, journal and pinned definition">
    <div class="flex flex-col gap-3">
      <StructuredDataPreview
        title="Identity"
        data={{
          runId: props.detail.id,
          scopeId: props.detail.scopeId,
          parentRunId: props.detail.parentRunId,
          revision: props.detail.revision,
        }}
      />
      {props.detail.error ? <StructuredDataPreview title="Error" data={props.detail.error} /> : null}
      {Object.keys(props.detail.effectBudget).length > 0 ? (
        <StructuredDataPreview
          title="Effect budget"
          data={Object.fromEntries(
            Object.entries(props.detail.effectBudget).map(([dimension, limit]) => [
              dimension,
              { used: props.detail.effectsUsed[dimension] ?? 0, limit },
            ]),
          )}
        />
      ) : null}
      <StructuredDataPreview
        title="Step journal"
        data={props.detail.steps.map((step) => ({
          stepKey: step.stepKey,
          sourcePath: step.sourcePath,
          iterationPath: step.iterationPath,
          outcome: step.outcome,
          dependency: step.dependency,
          effectKey: step.effectKey,
          effectState: step.effectState,
        }))}
      />
      <StructuredDataPreview title="Pinned definition" data={{ source: props.detail.source }} />
    </div>
  </Disclosure>
);

const RunOutcome = (props: { detail: WorkflowRunDetail }) => {
  const attentionStep = attentionStepFor(props.detail);
  const error = runErrorSummary(props.detail.error);
  if (attentionStep)
    return (
      <NoticeCard
        tone="warn"
        title={`${attentionStep.action ?? attentionStep.stepKey} needs an operator decision`}
        detail="Check the external provider before resolving this effect. Marking success resumes the pinned plan without repeating it; marking failure ends the run."
      />
    );
  if (error)
    return (
      <NoticeCard
        tone="error"
        title={error.message}
        detail={
          [error.code, error.retryable === null ? null : error.retryable ? "The run can retry." : "The run will not retry."]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
    );
  return null;
};

const RunBody = (props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) => {
  return (
    <>
      <div class="flex flex-col gap-4 px-3 py-3">
        <RunOutcome detail={props.detail} />
        <RunOverview detail={props.detail} state={props.state} />
      </div>
      <div class="px-3 pb-2">
        <h3 class="text-xs font-semibold text-primary">Execution steps</h3>
        <p class="text-[10px] text-dimmed">
          {formatNumber(props.detail.steps.length)} recorded step{props.detail.steps.length === 1 ? "" : "s"}
        </p>
      </div>
      <RunSteps steps={props.detail.steps} />
      <div class="flex flex-col gap-2 px-3 py-3">
        <RunPayloads detail={props.detail} />
        <DurableExecutionData detail={props.detail} />
      </div>
    </>
  );
};

export default function WorkflowRunDetailView(props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) {
  const attentionStep = attentionStepFor(props.detail);
  return (
    <DataPanel
      title={`${props.detail.workflowName} · revision ${props.detail.revision}`}
      subtitle={
        <span class="mt-1 flex flex-wrap items-center gap-2">
          <StatusBadge tone={RUN_TONE[props.detail.state]} label={RUN_LABEL[props.detail.state]} />
          <span class="text-dimmed">
            {props.detail.appId} · {props.detail.mode} · attempt {props.detail.attempt} · {formatRelative(props.detail.createdAt)}
          </span>
        </span>
      }
      actions={
        <div class="flex flex-wrap items-center justify-end gap-2">
          <a class="text-xs text-secondary hover:underline" href={workflowsFilter.build(props.state, { run: "" })}>
            Back to {props.state.view}
          </a>
          <WorkflowRunActions
            runId={props.detail.id}
            state={props.detail.state}
            attentionStep={
              attentionStep
                ? {
                    stepKey: attentionStep.stepKey,
                    action: attentionStep.action,
                  }
                : undefined
            }
          />
        </div>
      }
    >
      <RunBody detail={props.detail} state={props.state} />
    </DataPanel>
  );
}
