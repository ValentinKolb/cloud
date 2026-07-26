import { formatDurationMs, formatNumber, formatRelative } from "@valentinkolb/cloud/shared";
import { DataPanel, DataTable, type DataTableColumn, NoticeCard, StatusBadge, StructuredDataPreview } from "@valentinkolb/cloud/ui";
import type { WorkflowRunState } from "@valentinkolb/cloud/workflows";
import type { WorkflowRunDetail, WorkflowStepSummary } from "@valentinkolb/cloud/workflows/store";
import { type WorkflowsFilterState, workflowsFilter } from "../filters";
import { EFFECT_TONE, RUN_LABEL, RUN_TONE, STEP_TONE, stepDetail } from "../presentation";
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

const RunMetadata = (props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) => (
  <div class="flex flex-wrap gap-x-6 gap-y-1">
    <span>
      <span class="text-dimmed">Run</span> <span class="font-mono">{props.detail.id}</span>
    </span>
    <span>
      <span class="text-dimmed">Scope</span> <span class="font-mono">{props.detail.scopeId}</span>
    </span>
    <span>
      <span class="text-dimmed">Cause</span> {props.detail.eventType ?? "direct invocation"}
    </span>
    <span>
      <span class="text-dimmed">Occurred</span> {formatRelative(props.detail.occurredAt)}
    </span>
    <span>
      <span class="text-dimmed">Start lag</span> {formatDurationMs(props.detail.startLagMs)}
    </span>
    <span>
      <span class="text-dimmed">Duration</span> {formatDurationMs(props.detail.durationMs)}
    </span>
    {props.detail.parentRunId ? (
      <span>
        <span class="text-dimmed">Parent</span>{" "}
        <a
          class="font-mono hover:underline"
          href={workflowsFilter.build(props.state, { view: "runs", run: props.detail.parentRunId, parent: "" })}
        >
          {props.detail.parentRunId}
        </a>
      </span>
    ) : null}
    {Object.keys(props.detail.effectBudget).length > 0 ? (
      <span>
        <span class="text-dimmed">Effects</span>{" "}
        {Object.entries(props.detail.effectBudget)
          .map(([dimension, limit]) => `${dimension} ${props.detail.effectsUsed[dimension] ?? 0}/${limit}`)
          .join(" · ")}
      </span>
    ) : null}
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

const RunPayloads = (props: { detail: WorkflowRunDetail }) => (
  <>
    <div class="grid gap-3 lg:grid-cols-2">
      <StructuredDataPreview title="Inputs" data={props.detail.inputs} empty="No inputs." />
      <StructuredDataPreview title="Result" data={props.detail.result} empty={props.detail.resultMessage ?? "No result."} />
    </div>
    {props.detail.error ? <StructuredDataPreview title="Error" data={props.detail.error} /> : null}
    {props.detail.eventData ? <StructuredDataPreview title="Event payload" data={props.detail.eventData} /> : null}
  </>
);

const DurableExecutionData = (props: { detail: WorkflowRunDetail }) => (
  <details class="rounded-lg bg-[var(--ui-surface-subtle)] px-3 py-2">
    <summary class="cursor-pointer font-medium text-secondary">Durable execution data</summary>
    <div class="mt-3 flex flex-col gap-3">
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
  </details>
);

const RunFooter = (props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) => {
  const attentionStep = attentionStepFor(props.detail);
  return (
    <div class="flex flex-col gap-4 px-3 py-2 text-xs">
      <RunMetadata detail={props.detail} state={props.state} />
      <ChildLinks detail={props.detail} state={props.state} />
      {attentionStep ? (
        <NoticeCard
          tone="warn"
          title={`${attentionStep.action ?? attentionStep.stepKey} needs an operator decision`}
          detail="Check the external provider before resolving this effect. Marking success resumes the pinned plan without repeating it; marking failure ends the run."
        />
      ) : null}
      <RunPayloads detail={props.detail} />
      <DurableExecutionData detail={props.detail} />
    </div>
  );
};

export default function WorkflowRunDetailView(props: { detail: WorkflowRunDetail; state: WorkflowsFilterState }) {
  const attentionStep = attentionStepFor(props.detail);
  return (
    <DataPanel
      title={`${props.detail.workflowName} · revision ${props.detail.revision}`}
      subtitle={
        <span class="flex flex-wrap items-center gap-2">
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
      isEmpty={props.detail.steps.length === 0}
      empty="This run has not recorded a step yet."
      footer={<RunFooter detail={props.detail} state={props.state} />}
    >
      <RunSteps steps={props.detail.steps} />
    </DataPanel>
  );
}
