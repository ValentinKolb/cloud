import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  CodeDisplay,
  confirmDiscardIfDirty,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  IconButton,
  NumberInput,
  PanelDialog,
  panelDialogWideOptions,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  toast,
} from "@k2b/ui";
import { createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import {
  createIncomingAutomationSchema,
  type IncomingAutomationBackfill,
  type IncomingAutomationMatchPreview,
  type MailAutomationAction,
  type MailAutomationScope,
  type MailAutomationStep,
} from "../../contracts";
import type { IncomingAutomation } from "../../service/incoming-automations";
import type { MailWorkflowCatalogSnapshot } from "../../workflows/catalog";
import { readApiError } from "./api-response";
import {
  initialMailAutomationCondition,
  MailAutomationActionEditor,
  MailAutomationConditionsEditor,
  mailAutomationConditionLabel,
} from "./MailAutomationFields";
import {
  type AutomationActionKind,
  createMailAutomationAction,
  initialMailAutomationAction,
  mailAutomationActionKindLabels,
  mailAutomationActionKindsFor,
  mailAutomationActionLabel,
} from "./mail-automation-actions";
import { waitForMailPageTransition } from "./mail-page-transition";

export type IncomingAutomationPreset = "blank" | "ai-route" | "ai-tag" | "ai-draft";

const stepId = (): string => crypto.randomUUID();
const choice = (name: string, description: string) => ({ name, description });
const mailActionStep = (action: MailAutomationAction): MailAutomationStep => ({ id: stepId(), kind: "mail_action", action });
const directActionOrder: readonly AutomationActionKind[] = [
  "mark_read",
  "add_local_tag",
  "assign_user",
  "set_status",
  "add_keyword",
  "move_to_folder",
  "junk",
  "trash",
];
const branchActionOrder: readonly AutomationActionKind[] = [
  "set_status",
  "add_local_tag",
  "assign_user",
  "mark_read",
  "move_to_folder",
  "add_keyword",
  "junk",
  "trash",
];
const nextMailAction = (
  actions: MailAutomationAction[],
  catalog: MailWorkflowCatalogSnapshot,
  preferred: readonly AutomationActionKind[],
): MailAutomationAction | null => {
  const available = mailAutomationActionKindsFor({ actions, catalog });
  const kind = preferred.find((candidate) => available.includes(candidate));
  return kind ? createMailAutomationAction({ kind, actions, catalog }) : null;
};
const activeBackfillStates = new Set<IncomingAutomationBackfill["state"]>(["queued", "running", "waiting"]);

type AutomationOutput = {
  id: string;
  label: string;
  type: "text" | "text_array";
  choices: string[];
};

type AutomationContentStep = Extract<MailAutomationStep, { kind: "create_reply_draft" | "add_comment" }>;
type AutomationTextSource = AutomationContentStep["body"];

const customTextSource = (): AutomationTextSource => ({ kind: "custom", value: "" });
const outputTextSource = (sourceStepId: string): AutomationTextSource => ({ kind: "step_output", sourceStepId });
const customTextSourceId = "custom";
const textSourceValue = (source: AutomationTextSource): string => (source.kind === "custom" ? customTextSourceId : source.sourceStepId);
const textSourceOptions = (outputs: AutomationOutput[]) => [
  { id: customTextSourceId, label: "Custom text" },
  ...outputs.filter((output) => output.type === "text").map((output) => ({ id: output.id, label: output.label })),
];
const selectTextSource = (source: AutomationTextSource, value: string | null): AutomationTextSource => {
  if (!value || value === customTextSourceId) return source.kind === "custom" ? source : customTextSource();
  return outputTextSource(value);
};
const textSourceLabel = (source: AutomationTextSource, outputs: AutomationOutput[]): string =>
  source.kind === "custom"
    ? "Uses custom text"
    : `Uses ${outputs.find((output) => output.id === source.sourceStepId)?.label ?? "missing output"}`;

const outputForStep = (step: MailAutomationStep, index: number): AutomationOutput | null => {
  if (step.kind === "ai_generate_text") return { id: step.id, label: `Generated text · step ${index + 1}`, type: "text", choices: [] };
  if (step.kind === "ai_classify") {
    return { id: step.id, label: `Classification · step ${index + 1}`, type: "text", choices: step.choices.map((item) => item.name) };
  }
  if (step.kind === "ai_classify_many") {
    return {
      id: step.id,
      label: `Classifications · step ${index + 1}`,
      type: "text_array",
      choices: step.choices.map((item) => item.name),
    };
  }
  return null;
};

const outputReferencesResolve = (steps: readonly MailAutomationStep[], inherited: ReadonlySet<string>): boolean => {
  const available = new Set(inherited);
  for (const step of steps) {
    if (
      (step.kind === "create_reply_draft" || step.kind === "add_comment") &&
      step.body.kind === "step_output" &&
      !available.has(step.body.sourceStepId)
    )
      return false;
    if (step.kind === "if") {
      if (!available.has(step.condition.sourceStepId)) return false;
      if (!outputReferencesResolve(step.then, available) || !outputReferencesResolve(step.else, available)) return false;
    }
    if (step.kind === "ai_generate_text" || step.kind === "ai_classify" || step.kind === "ai_classify_many") available.add(step.id);
  }
  return true;
};

const ifStep = (
  output: AutomationOutput,
  value: string,
  then: MailAutomationStep[] = [],
  otherwise: MailAutomationStep[] = [],
): MailAutomationStep => ({
  id: stepId(),
  kind: "if",
  condition: { sourceStepId: output.id, operator: output.type === "text_array" ? "includes" : "equals", value },
  then,
  else: otherwise,
});

const classificationSteps = (
  many: boolean,
  catalog: MailWorkflowCatalogSnapshot,
  actions: MailAutomationAction[] = [],
): MailAutomationStep[] => {
  const available = mailAutomationActionKindsFor({ actions, catalog });
  const fallbackAction = nextMailAction(actions, catalog, branchActionOrder);
  const choices = [
    choice("Important", "Needs personal attention or a timely response"),
    choice("Routine", "Can be handled as routine mail"),
  ];
  const classifier: MailAutomationStep = many
    ? {
        id: stepId(),
        kind: "ai_classify_many",
        instructions: "Choose the categories that best apply to this message.",
        choices,
        maxChoices: 2,
      }
    : {
        id: stepId(),
        kind: "ai_classify",
        instructions: "Choose the single best category for this message.",
        choices,
      };
  const output = outputForStep(classifier, 0)!;
  const primaryAction = available.includes("set_status")
    ? mailActionStep({ kind: "set_status", status: "needs_action" })
    : fallbackAction
      ? mailActionStep(fallbackAction)
      : null;
  if (!primaryAction) return [classifier];
  const otherwise = !many && available.includes("set_status") ? [mailActionStep({ kind: "set_status", status: "done" })] : [];
  return [classifier, ifStep(output, choices[0]!.name, [primaryAction], otherwise)];
};

const generatedTextStep = (): Extract<MailAutomationStep, { kind: "ai_generate_text" }> => ({
  id: stepId(),
  kind: "ai_generate_text",
  instructions: "Write concise, useful text based on the incoming message. Do not invent facts or commitments.",
  maxOutputChars: 4_000,
});

const replyDraftStep = (
  catalog: MailWorkflowCatalogSnapshot,
  sourceStepId?: string,
): Extract<MailAutomationStep, { kind: "create_reply_draft" }> | null => {
  const identity = (catalog.senderIdentities ?? [])[0];
  if (!identity) return null;
  return {
    id: stepId(),
    kind: "create_reply_draft",
    body: sourceStepId ? outputTextSource(sourceStepId) : customTextSource(),
    senderIdentityId: identity.id,
  };
};

const commentStep = (sourceStepId?: string): Extract<MailAutomationStep, { kind: "add_comment" }> => ({
  id: stepId(),
  kind: "add_comment",
  body: sourceStepId ? outputTextSource(sourceStepId) : customTextSource(),
});

const presetSteps = (preset: IncomingAutomationPreset, catalog: MailWorkflowCatalogSnapshot): MailAutomationStep[] => {
  if (preset === "ai-route") return classificationSteps(false, catalog);
  if (preset === "ai-tag") {
    const tags = (catalog.localTags ?? []).slice(0, 4);
    if (tags.length >= 2) {
      const maxChoices = Math.min(3, tags.length);
      const classifier: MailAutomationStep = {
        id: stepId(),
        kind: "ai_classify_many",
        instructions: "Choose the matching tags for this message.",
        choices: tags.map((tag) => choice(tag.name, `The message belongs to the ${tag.name} category`)),
        maxChoices,
      };
      const output = outputForStep(classifier, 0)!;
      return [classifier, ...tags.map((tag) => ifStep(output, tag.name, [mailActionStep({ kind: "add_local_tag", tagId: tag.id })]))];
    }
    return [];
  }
  if (preset === "ai-draft") {
    const generated: Extract<MailAutomationStep, { kind: "ai_generate_text" }> = {
      ...generatedTextStep(),
      instructions: "Write a concise, helpful reply in the language of the incoming message. Do not invent facts or commitments.",
    };
    const draft = replyDraftStep(catalog, generated.id);
    return draft ? [generated, draft] : [];
  }
  return [mailActionStep(initialMailAutomationAction("mark_read", catalog))];
};

const flattenSteps = (steps: readonly MailAutomationStep[]): MailAutomationStep[] =>
  steps.flatMap((step) => (step.kind === "if" ? [step, ...flattenSteps(step.then), ...flattenSteps(step.else)] : [step]));

const hasAi = (steps: readonly MailAutomationStep[]): boolean => flattenSteps(steps).some((step) => step.kind.startsWith("ai_"));
const maxAiCalls = (steps: readonly MailAutomationStep[]): number =>
  steps.reduce((total, step) => {
    if (step.kind.startsWith("ai_")) return total + 1;
    if (step.kind === "if") return total + Math.max(maxAiCalls(step.then), maxAiCalls(step.else));
    return total;
  }, 0);
const scopeLabel = (scope: MailAutomationScope): string => {
  if (scope.mode === "all") return "All incoming mail";
  if (scope.conditions.items.length === 1) return mailAutomationConditionLabel(scope.conditions.items[0]!);
  return `${scope.conditions.mode === "all" ? "All" : "Any"} of ${scope.conditions.items.length} conditions`;
};

const flowLabel = (automation: IncomingAutomation, catalog: MailWorkflowCatalogSnapshot): string => {
  const steps = flattenSteps(automation.steps);
  const firstAction = steps.find((step): step is Extract<MailAutomationStep, { kind: "mail_action" }> => step.kind === "mail_action");
  const aiCalls = steps.filter((step) => step.kind.startsWith("ai_")).length;
  const parts = [
    `${steps.length} step${steps.length === 1 ? "" : "s"}`,
    aiCalls > 0 ? `${aiCalls} AI call${aiCalls === 1 ? "" : "s"}` : null,
    firstAction ? mailAutomationActionLabel(firstAction.action, catalog) : null,
  ].filter(Boolean);
  return parts.join(" · ");
};

function ChoiceEditor(props: {
  step: Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }>;
  context?: string;
  onChange: (step: Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }>) => void;
}) {
  const remove = (index: number) => {
    const choices = props.step.choices.filter((_, itemIndex) => itemIndex !== index);
    props.onChange(
      props.step.kind === "ai_classify_many"
        ? { ...props.step, choices, maxChoices: Math.min(props.step.maxChoices, choices.length) }
        : { ...props.step, choices },
    );
  };
  const replace = (index: number, patch: Partial<(typeof props.step.choices)[number]>) =>
    props.onChange({
      ...props.step,
      choices: props.step.choices.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, ...patch } : candidate)),
    });
  return (
    <div class="flex flex-col gap-2">
      <Index each={props.step.choices}>
        {(candidate, index) => (
          <div class="rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
            <div class="grid gap-2 md:grid-cols-[minmax(8rem,0.6fr)_minmax(12rem,1fr)_auto]">
              <TextInput
                label={`Choice ${index + 1}`}
                value={() => candidate().name}
                onValueChange={(name) => replace(index, { name })}
                maxLength={80}
                required
              />
              <TextInput
                label="Meaning"
                value={() => candidate().description}
                onValueChange={(description) => replace(index, { description })}
                maxLength={500}
                required
              />
              <div class="flex items-end">
                <IconButton
                  type="button"
                  size="sm"
                  label={`Remove choice ${index + 1}${props.context ? ` from ${props.context}` : ""}`}
                  disabled={props.step.choices.length <= 2}
                  onClick={() => remove(index)}
                >
                  <i class="ti ti-x" aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </div>
        )}
      </Index>
      <Show when={props.step.choices.length < 10}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          class="self-start"
          onClick={() =>
            props.onChange({
              ...props.step,
              choices: [...props.step.choices, choice(`Choice ${props.step.choices.length + 1}`, "Describe when this choice applies")],
            })
          }
        >
          <i class="ti ti-plus" aria-hidden="true" /> Add choice
        </Button>
      </Show>
    </div>
  );
}

function AutomationStepsEditor(props: {
  steps: MailAutomationStep[];
  availableActions: MailAutomationAction[];
  availableOutputs?: AutomationOutput[];
  catalog: MailWorkflowCatalogSnapshot;
  allowEmpty?: boolean;
  maxSteps?: number;
  labelContext?: string;
  onChange: (steps: MailAutomationStep[]) => void;
}) {
  const [expandedStepIds, setExpandedStepIds] = createSignal(new Set(props.steps.slice(0, 1).map((step) => step.id)));
  const actionsBefore = (index: number): MailAutomationAction[] => [
    ...props.availableActions,
    ...flattenSteps(props.steps.slice(0, index)).flatMap((step) => (step.kind === "mail_action" ? [step.action] : [])),
  ];
  const outputsBefore = (index: number): AutomationOutput[] => [
    ...(props.availableOutputs ?? []),
    ...props.steps.slice(0, index).flatMap((step, stepIndex) => {
      const output = outputForStep(step, stepIndex);
      return output ? [output] : [];
    }),
  ];
  const replace = (index: number, step: MailAutomationStep) =>
    props.onChange(props.steps.map((candidate, candidateIndex) => (candidateIndex === index ? step : candidate)));
  const remove = (index: number) => props.onChange(props.steps.filter((_, candidateIndex) => candidateIndex !== index));
  const canMove = (index: number, offset: -1 | 1): boolean => {
    const destination = index + offset;
    if (destination < 0 || destination >= props.steps.length) return false;
    const next = [...props.steps];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    return outputReferencesResolve(next, new Set((props.availableOutputs ?? []).map((output) => output.id)));
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (!canMove(index, offset)) return;
    const next = [...props.steps];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    props.onChange(next);
  };
  const expand = (id: string) => setExpandedStepIds((current) => new Set(current).add(id));
  const append = (step: MailAutomationStep) => {
    expand(step.id);
    props.onChange([...props.steps, step]);
  };
  const appendMany = (steps: MailAutomationStep[]) => {
    steps.forEach((step) => expand(step.id));
    props.onChange([...props.steps, ...steps]);
  };
  const insertAfterOutput = (index: number, sourceStepId: string, step: MailAutomationStep) => {
    let destination = index + 1;
    while (destination < props.steps.length) {
      const candidate = props.steps[destination]!;
      const reference =
        candidate.kind === "create_reply_draft" || candidate.kind === "add_comment"
          ? candidate.body.kind === "step_output"
            ? candidate.body.sourceStepId
            : null
          : candidate.kind === "if"
            ? candidate.condition.sourceStepId
            : null;
      if (reference !== sourceStepId) break;
      destination += 1;
    }
    const next = [...props.steps];
    next.splice(destination, 0, step);
    expand(step.id);
    props.onChange(next);
  };
  const setExpanded = (id: string, value: boolean) =>
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  const stepLabel = (step: MailAutomationStep): string => {
    if (step.kind === "mail_action") return "Mail action";
    if (step.kind === "ai_generate_text") return "AI generate text";
    if (step.kind === "ai_classify") return "AI classify";
    if (step.kind === "ai_classify_many") return "AI classify many";
    if (step.kind === "create_reply_draft") return "Create reply draft";
    if (step.kind === "add_comment") return "Add internal comment";
    return "If";
  };
  const accessibleStepLabel = (step: MailAutomationStep, index: number): string =>
    `${stepLabel(step)} step ${index + 1}${props.labelContext ? ` in ${props.labelContext}` : ""}`;
  const addItems = () => {
    const actions = actionsBefore(props.steps.length);
    const outputs = outputsBefore(props.steps.length);
    const latestOutput = outputs.at(-1);
    const nextAction = nextMailAction(actions, props.catalog, directActionOrder);
    const replyDraft = replyDraftStep(props.catalog);
    const remaining = (props.maxSteps ?? 20) - props.steps.length;
    const classification = classificationSteps(false, props.catalog, actions);
    const multiClassification = classificationSteps(true, props.catalog, actions);
    return [
      ...(nextAction
        ? [
            {
              label: `Mail action · ${mailAutomationActionKindLabels[nextAction.kind]}`,
              icon: "ti ti-mail-forward",
              action: () => append(mailActionStep(nextAction)),
            },
          ]
        : []),
      ...(replyDraft
        ? [
            {
              label: "Create reply draft",
              icon: "ti ti-message-reply",
              action: () => append(replyDraft),
            },
          ]
        : []),
      {
        label: "Add internal comment",
        icon: "ti ti-message-plus",
        action: () => append(commentStep()),
      },
      {
        label: "AI generate text",
        icon: "ti ti-sparkles",
        action: () => append(generatedTextStep()),
      },
      ...(classification.length <= remaining
        ? [{ label: "AI classify", icon: "ti ti-list-check", action: () => appendMany(classification) }]
        : []),
      ...(multiClassification.length <= remaining
        ? [{ label: "AI classify many", icon: "ti ti-tags", action: () => appendMany(multiClassification) }]
        : []),
      ...(latestOutput
        ? [
            {
              label: "If output matches",
              icon: "ti ti-git-branch",
              action: () => append(ifStep(latestOutput, latestOutput.choices[0] ?? "value")),
            },
          ]
        : []),
    ];
  };
  const menuItems = createMemo(addItems);

  return (
    <div class="flex flex-col gap-2">
      <For each={props.steps}>
        {(step, index) => {
          const actions = () => actionsBefore(index());
          return (
            <div class="relative overflow-hidden rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)]">
              <div class="flex items-center gap-2 p-3">
                <IconButton
                  type="button"
                  size="sm"
                  label={`${expandedStepIds().has(step.id) ? "Collapse" : "Expand"} ${accessibleStepLabel(step, index())}`}
                  onClick={() => setExpanded(step.id, !expandedStepIds().has(step.id))}
                >
                  <i class={`ti ${expandedStepIds().has(step.id) ? "ti-chevron-down" : "ti-chevron-right"}`} aria-hidden="true" />
                </IconButton>
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface)] text-[11px] font-semibold text-dimmed">
                  {index() + 1}
                </span>
                <i
                  class={`ti shrink-0 text-dimmed ${
                    step.kind === "mail_action"
                      ? "ti-mail-forward"
                      : step.kind === "ai_generate_text"
                        ? "ti-sparkles"
                        : step.kind === "ai_classify"
                          ? "ti-list-check"
                          : step.kind === "ai_classify_many"
                            ? "ti-tags"
                            : step.kind === "create_reply_draft"
                              ? "ti-message-reply"
                              : step.kind === "add_comment"
                                ? "ti-message-plus"
                                : "ti-git-branch"
                  }`}
                  aria-hidden="true"
                />
                <div class="min-w-0 flex-1">
                  <strong class="block truncate text-xs text-primary">{stepLabel(step)}</strong>
                  <span class="block truncate text-[11px] text-dimmed">
                    {step.kind === "mail_action"
                      ? mailAutomationActionLabel(step.action, props.catalog)
                      : step.kind === "ai_generate_text"
                        ? "Produces text"
                        : step.kind === "ai_classify"
                          ? `Produces one of ${step.choices.length} choices`
                          : step.kind === "ai_classify_many"
                            ? `Produces up to ${step.maxChoices} choices`
                            : step.kind === "create_reply_draft" || step.kind === "add_comment"
                              ? textSourceLabel(step.body, outputsBefore(index()))
                              : `Uses ${outputsBefore(index()).find((output) => output.id === step.condition.sourceStepId)?.label ?? "missing output"}`}
                  </span>
                </div>
                <IconButton
                  type="button"
                  size="sm"
                  label={`Move ${accessibleStepLabel(step, index())} up`}
                  disabled={!canMove(index(), -1)}
                  onClick={() => move(index(), -1)}
                >
                  <i class="ti ti-arrow-up" aria-hidden="true" />
                </IconButton>
                <IconButton
                  type="button"
                  size="sm"
                  label={`Move ${accessibleStepLabel(step, index())} down`}
                  disabled={!canMove(index(), 1)}
                  onClick={() => move(index(), 1)}
                >
                  <i class="ti ti-arrow-down" aria-hidden="true" />
                </IconButton>
                <IconButton
                  type="button"
                  size="sm"
                  label={`Remove ${accessibleStepLabel(step, index())}`}
                  disabled={!props.allowEmpty && props.steps.length === 1}
                  onClick={() => remove(index())}
                >
                  <i class="ti ti-x" aria-hidden="true" />
                </IconButton>
              </div>

              <Show when={expandedStepIds().has(step.id)}>
                <div class="border-t border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-3">
                  <Show when={step.kind === "mail_action"}>
                    <MailAutomationActionEditor
                      action={(step as Extract<MailAutomationStep, { kind: "mail_action" }>).action}
                      otherActions={actions()}
                      catalog={props.catalog}
                      onChange={(action) => replace(index(), { ...step, kind: "mail_action", action })}
                    />
                  </Show>

                  <Show when={step.kind === "ai_generate_text"}>
                    <div class="flex flex-col gap-3">
                      <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem]">
                        <TextInput
                          label="Instructions"
                          description="The incoming message is supplied as untrusted context. Say exactly what text should be created."
                          value={() => (step.kind === "ai_generate_text" ? step.instructions : "")}
                          onValueChange={(instructions) => step.kind === "ai_generate_text" && replace(index(), { ...step, instructions })}
                          maxLength={4_000}
                          multiline
                          lines={3}
                          required
                        />
                        <NumberInput
                          label="Maximum characters"
                          value={() => (step.kind === "ai_generate_text" ? step.maxOutputChars : 4_000)}
                          onValueChange={(maxOutputChars) =>
                            step.kind === "ai_generate_text" && replace(index(), { ...step, maxOutputChars: maxOutputChars ?? 4_000 })
                          }
                          min={200}
                          max={10_000}
                          step={100}
                        />
                      </div>
                      <div class="flex items-center gap-3 rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
                        <i class="ti ti-variable text-dimmed" aria-hidden="true" />
                        <div class="min-w-0 flex-1">
                          <strong class="block text-xs text-primary">Output · Text</strong>
                          <span class="block text-[11px] text-dimmed">Later compatible steps can reference this workflow output.</span>
                        </div>
                        <Dropdown.Root
                          position="bottom-right"
                          width="16rem"
                          items={[
                            ...((props.catalog.senderIdentities ?? []).length > 0
                              ? [
                                  {
                                    label: "Create reply draft",
                                    icon: "ti ti-message-reply",
                                    action: () => {
                                      if (step.kind !== "ai_generate_text") return;
                                      const draft = replyDraftStep(props.catalog, step.id);
                                      if (draft) insertAfterOutput(index(), step.id, draft);
                                    },
                                  },
                                ]
                              : []),
                            {
                              label: "Add internal comment",
                              icon: "ti ti-message-plus",
                              action: () => step.kind === "ai_generate_text" && insertAfterOutput(index(), step.id, commentStep(step.id)),
                            },
                          ]}
                        >
                          <Dropdown.Trigger type="button" variant="secondary" size="sm">
                            <i class="ti ti-plus" aria-hidden="true" /> Use output
                          </Dropdown.Trigger>
                        </Dropdown.Root>
                      </div>
                    </div>
                  </Show>

                  <Show when={step.kind === "ai_classify" || step.kind === "ai_classify_many"}>
                    {(() => {
                      const classifier = step as Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }>;
                      return (
                        <div class="flex flex-col gap-3">
                          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem]">
                            <TextInput
                              label="Instructions"
                              description="Define the classification goal. Choice descriptions below define the decision boundary."
                              value={() => classifier.instructions}
                              onValueChange={(instructions) => replace(index(), { ...classifier, instructions })}
                              maxLength={4_000}
                              multiline
                              lines={2}
                              required
                            />
                            <Show when={classifier.kind === "ai_classify_many"}>
                              <NumberInput
                                label="Maximum matches"
                                value={() => (classifier.kind === "ai_classify_many" ? classifier.maxChoices : 1)}
                                onValueChange={(maxChoices) =>
                                  classifier.kind === "ai_classify_many" && replace(index(), { ...classifier, maxChoices: maxChoices ?? 1 })
                                }
                                min={1}
                                max={classifier.choices.length}
                              />
                            </Show>
                          </div>
                          <ChoiceEditor
                            step={classifier}
                            context={[props.labelContext, `${stepLabel(step)} step ${index() + 1}`].filter(Boolean).join(", ")}
                            onChange={(next) => replace(index(), next)}
                          />
                          <div class="flex items-center gap-3 rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
                            <i class="ti ti-variable text-dimmed" aria-hidden="true" />
                            <div class="min-w-0 flex-1">
                              <strong class="block text-xs text-primary">
                                Output · {classifier.kind === "ai_classify_many" ? "Choice list" : "Choice"}
                              </strong>
                              <span class="block text-[11px] text-dimmed">Conditions reference this normal workflow output.</span>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const output = outputForStep(classifier, index());
                                if (output)
                                  insertAfterOutput(index(), classifier.id, ifStep(output, classifier.choices[0]?.name ?? "value"));
                              }}
                            >
                              <i class="ti ti-plus" aria-hidden="true" /> Add condition
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </Show>

                  <Show when={step.kind === "create_reply_draft"}>
                    <div class="grid gap-3 md:grid-cols-2">
                      <Select
                        label="Text source"
                        value={() => (step.kind === "create_reply_draft" ? textSourceValue(step.body) : customTextSourceId)}
                        onValueChange={(value) =>
                          step.kind === "create_reply_draft" && replace(index(), { ...step, body: selectTextSource(step.body, value) })
                        }
                        options={textSourceOptions(outputsBefore(index()))}
                      />
                      <Select
                        label="From address"
                        value={() => (step.kind === "create_reply_draft" ? step.senderIdentityId : "")}
                        onValueChange={(senderIdentityId) =>
                          step.kind === "create_reply_draft" && replace(index(), { ...step, senderIdentityId: senderIdentityId ?? "" })
                        }
                        options={(props.catalog.senderIdentities ?? []).map((identity) => ({ id: identity.id, label: identity.name }))}
                      />
                      <Show when={step.kind === "create_reply_draft" && step.body.kind === "custom"}>
                        <div class="md:col-span-2">
                          <TextInput
                            label="Reply text"
                            description="Write the draft body directly. Mail template variables are supported."
                            value={() => (step.kind === "create_reply_draft" && step.body.kind === "custom" ? step.body.value : "")}
                            onValueChange={(value) =>
                              step.kind === "create_reply_draft" &&
                              step.body.kind === "custom" &&
                              replace(index(), { ...step, body: { ...step.body, value } })
                            }
                            maxLength={50_000}
                            markdown
                            required
                          />
                        </div>
                      </Show>
                      <p class="text-[11px] text-dimmed md:col-span-2">Creates a reply draft for human review and never sends it.</p>
                    </div>
                  </Show>

                  <Show when={step.kind === "add_comment"}>
                    <div class="flex flex-col gap-3">
                      <Select
                        label="Text source"
                        value={() => (step.kind === "add_comment" ? textSourceValue(step.body) : customTextSourceId)}
                        onValueChange={(value) =>
                          step.kind === "add_comment" && replace(index(), { ...step, body: selectTextSource(step.body, value) })
                        }
                        options={textSourceOptions(outputsBefore(index()))}
                      />
                      <Show when={step.kind === "add_comment" && step.body.kind === "custom"}>
                        <TextInput
                          label="Comment"
                          description="Write the internal conversation comment directly. Mail template variables are supported."
                          value={() => (step.kind === "add_comment" && step.body.kind === "custom" ? step.body.value : "")}
                          onValueChange={(value) =>
                            step.kind === "add_comment" &&
                            step.body.kind === "custom" &&
                            replace(index(), { ...step, body: { ...step.body, value } })
                          }
                          maxLength={50_000}
                          multiline
                          lines={4}
                          required
                        />
                      </Show>
                    </div>
                  </Show>

                  <Show when={step.kind === "if"}>
                    {(() => {
                      const conditionStep = step as Extract<MailAutomationStep, { kind: "if" }>;
                      const outputs = () => outputsBefore(index());
                      const source = () => outputs().find((output) => output.id === conditionStep.condition.sourceStepId) ?? outputs()[0];
                      const context = [props.labelContext, `If step ${index() + 1}`].filter(Boolean).join(", ");
                      return (
                        <div class="flex flex-col gap-3">
                          <div class="grid gap-3 md:grid-cols-2">
                            <Select
                              label="Output"
                              value={() => conditionStep.condition.sourceStepId}
                              onValueChange={(sourceStepId) => {
                                const nextSource = outputs().find((output) => output.id === sourceStepId);
                                if (!nextSource) return;
                                replace(index(), {
                                  ...conditionStep,
                                  condition: {
                                    sourceStepId: nextSource.id,
                                    operator: nextSource.type === "text_array" ? "includes" : "equals",
                                    value: nextSource.choices[0] ?? conditionStep.condition.value,
                                  },
                                });
                              }}
                              options={outputs().map((output) => ({ id: output.id, label: output.label }))}
                            />
                            <Show
                              when={(source()?.choices.length ?? 0) > 0}
                              fallback={
                                <TextInput
                                  label="Equals"
                                  value={() => conditionStep.condition.value}
                                  onValueChange={(value) =>
                                    replace(index(), { ...conditionStep, condition: { ...conditionStep.condition, value } })
                                  }
                                  maxLength={500}
                                  required
                                />
                              }
                            >
                              <Select
                                label={conditionStep.condition.operator === "includes" ? "Contains" : "Equals"}
                                value={() => conditionStep.condition.value}
                                onValueChange={(value) =>
                                  value && replace(index(), { ...conditionStep, condition: { ...conditionStep.condition, value } })
                                }
                                options={(source()?.choices ?? []).map((value) => ({ id: value, label: value }))}
                              />
                            </Show>
                          </div>
                          <div class="rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
                            <strong class="mb-2 block text-xs text-primary">Then</strong>
                            <AutomationStepsEditor
                              steps={conditionStep.then}
                              availableActions={actions()}
                              availableOutputs={outputs()}
                              catalog={props.catalog}
                              labelContext={`${context}, Then`}
                              allowEmpty
                              maxSteps={12}
                              onChange={(then) => replace(index(), { ...conditionStep, then })}
                            />
                          </div>
                          <div class="rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
                            <strong class="mb-2 block text-xs text-primary">Else</strong>
                            <AutomationStepsEditor
                              steps={conditionStep.else}
                              availableActions={actions()}
                              availableOutputs={outputs()}
                              catalog={props.catalog}
                              labelContext={`${context}, Else`}
                              allowEmpty
                              maxSteps={12}
                              onChange={(otherwise) => replace(index(), { ...conditionStep, else: otherwise })}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={props.steps.length < (props.maxSteps ?? 20) && menuItems().length > 0}>
        <Dropdown.Root position="bottom-right" width="18rem" items={menuItems()}>
          <Dropdown.Trigger type="button" variant="secondary" size="sm" class="self-start">
            <i class="ti ti-plus" aria-hidden="true" /> Add step
          </Dropdown.Trigger>
        </Dropdown.Root>
      </Show>
    </div>
  );
}

function IncomingAutomationEditor(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  automation: IncomingAutomation | null;
  preset: IncomingAutomationPreset;
  initialScope?: MailAutomationScope;
  initialAction?: AutomationActionKind;
  initialName?: string;
  close: () => void;
  onSaved: (automation: IncomingAutomation) => void;
  onBackfillStarted: (backfill: IncomingAutomationBackfill) => void;
}) {
  const initialSteps = () => {
    if (props.automation) return props.automation.steps;
    if (props.initialAction) return [mailActionStep(initialMailAutomationAction(props.initialAction, props.catalog))];
    return presetSteps(props.preset, props.catalog);
  };
  const initialName = props.automation?.name ?? props.initialName ?? "";
  const initialEnabled = props.automation?.enabled ?? false;
  const initialScope = props.automation?.scope ?? props.initialScope ?? ({ mode: "all" } as const);
  const initialStepList = initialSteps();
  const initialMatchingConditions =
    initialScope.mode === "matching" ? initialScope.conditions : { mode: "all" as const, items: [initialMailAutomationCondition()] };
  const [name, setName] = createSignal(initialName);
  const [enabled, setEnabled] = createSignal(initialEnabled);
  const [scope, setScope] = createSignal<MailAutomationScope>(initialScope);
  const [matchingConditions, setMatchingConditions] = createSignal(initialMatchingConditions);
  const [steps, setSteps] = createSignal<MailAutomationStep[]>(initialStepList);
  const [applyExisting, setApplyExisting] = createSignal(false);
  const [nameTouched, setNameTouched] = createSignal(false);
  const [scopeTouched, setScopeTouched] = createSignal(false);
  const baseline = JSON.stringify({
    name: initialName,
    enabled: initialEnabled,
    scope: initialScope,
    steps: initialStepList,
    applyExisting: false,
  });
  const dirty = () =>
    JSON.stringify({ name: name(), enabled: enabled(), scope: scope(), steps: steps(), applyExisting: applyExisting() }) !== baseline;

  const save = mutation.create<
    { automation: IncomingAutomation; backfill: IncomingAutomationBackfill | null; backfillError: string | null } | null,
    void
  >({
    mutation: async (_, { abortSignal }) => {
      const input = { name: name().trim(), enabled: enabled(), scope: scope(), steps: steps() };
      let shouldBackfill = applyExisting() && enabled() && !hasAi(input.steps);
      if (shouldBackfill) {
        const previewResponse = await apiClient.mailboxes[":mailboxId"]["incoming-automations"].preview.$post(
          { param: { mailboxId: props.mailboxId }, json: { scope: input.scope } },
          { init: { signal: abortSignal } },
        );
        if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview existing messages"));
        const preview: IncomingAutomationMatchPreview = await previewResponse.json();
        if (preview.messageCount === 0) {
          toast("No existing messages match this automation", { title: "Automation applies to future mail" });
          shouldBackfill = false;
        } else {
          const confirmed = await prompts.confirm(
            preview.exact
              ? `${preview.messageCount} existing message${preview.messageCount === 1 ? "" : "s"} in ${preview.conversationCount} conversation${preview.conversationCount === 1 ? "" : "s"} match.`
              : `${preview.messageCount} existing incoming message${preview.messageCount === 1 ? "" : "s"} will be scanned and evaluated.`,
            { title: "Apply automation to existing mail?", confirmText: "Save and start backfill" },
          );
          if (!confirmed || abortSignal.aborted) return null;
        }
      }
      const response = props.automation
        ? await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].$put(
            {
              param: { mailboxId: props.mailboxId, automationId: props.automation.id },
              json: { ...input, expectedRevision: props.automation.revision },
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"]["incoming-automations"].$post(
            { param: { mailboxId: props.mailboxId }, json: input },
            { init: { signal: abortSignal } },
          );
      if (!response.ok) throw new Error(await readApiError(response, "Could not save incoming automation"));
      const automation = await response.json();
      if (!shouldBackfill) return { automation, backfill: null, backfillError: null };
      const backfillResponse = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].backfills.$post(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { operationId: crypto.randomUUID(), expectedRevision: automation.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!backfillResponse.ok) {
        return {
          automation,
          backfill: null,
          backfillError: await readApiError(backfillResponse, "Could not start existing-message backfill"),
        };
      }
      return { automation, backfill: await backfillResponse.json(), backfillError: null };
    },
    onSuccess: (result) => {
      if (!result) return;
      props.onSaved(result.automation);
      if (result.backfill) props.onBackfillStarted(result.backfill);
      toast.success(props.automation ? "Incoming automation updated" : "Incoming automation created");
      props.close();
      if (result.backfillError) void prompts.error(`The automation was saved, but its backfill did not start: ${result.backfillError}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const validation = () => createIncomingAutomationSchema.safeParse({ name: name(), enabled: enabled(), scope: scope(), steps: steps() });
  const validationMessage = (field: "name" | "scope" | "steps") => {
    if (field === "name" && !nameTouched()) return null;
    if (field === "scope" && !scopeTouched()) return null;
    const result = validation();
    if (result.success) return null;
    const issue = result.error.issues.find((candidate) => candidate.path[0] === field);
    if (!issue) return null;
    if (field === "name") return name().trim() ? "Use 120 characters or fewer." : "Enter a name.";
    if (field === "scope") {
      const conditionIndex = typeof issue.path[3] === "number" ? issue.path[3] : null;
      const prefix = conditionIndex === null ? "Condition" : `Condition ${conditionIndex + 1}`;
      return issue.code === "custom" ? `${prefix}: ${issue.message}.` : `${prefix}: Enter a value.`;
    }
    const stepIndex = typeof issue.path[1] === "number" ? issue.path[1] : null;
    if (stepIndex === null) return "Add at least one step.";
    const location = [`Step ${stepIndex + 1}`];
    for (let index = 2; index < issue.path.length; index += 1) {
      if (issue.path[index] === "choices" && typeof issue.path[index + 1] === "number") {
        location.push(`choice ${(issue.path[index + 1] as number) + 1}`);
        index += 1;
        continue;
      }
      if ((issue.path[index] === "then" || issue.path[index] === "else") && typeof issue.path[index + 1] === "number") {
        location.push(`${issue.path[index] === "then" ? "Then" : "Else"} step ${(issue.path[index + 1] as number) + 1}`);
        index += 1;
        continue;
      }
      if (issue.path[index] === "steps" && typeof issue.path[index + 1] === "number") {
        location.push(`step ${(issue.path[index + 1] as number) + 1}`);
        index += 1;
      }
    }
    const fieldName = issue.path.at(-1);
    const message =
      issue.code === "custom"
        ? issue.message
        : fieldName === "instructions"
          ? "Enter instructions"
          : fieldName === "name"
            ? "Enter a choice name"
            : fieldName === "description"
              ? "Describe when this choice applies"
              : fieldName === "senderIdentityId"
                ? "Select a from address"
                : fieldName === "sourceStepId"
                  ? "Select an earlier compatible output"
                  : fieldName === "value"
                    ? issue.path.includes("body")
                      ? "Enter text"
                      : "Enter a value to compare"
                    : "Complete the required fields";
    return `${location.join(", ")}: ${message}.`;
  };
  const usesAi = () => hasAi(steps());
  const closeSafely = async () => {
    if (save.loading()) return;
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.automation ? "Edit incoming automation" : "Create incoming automation"}
        subtitle="Mix mail and AI building blocks in one top-to-bottom flow."
        icon="ti ti-mailbox"
        close={() => void closeSafely()}
        closeDisabled={save.loading()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Basics"
          subtitle="New automations start inactive so you can review them safely."
          icon="ti ti-adjustments"
        >
          <TextInput
            label="Name"
            value={name}
            onValueChange={setName}
            onBlur={() => setNameTouched(true)}
            error={() => validationMessage("name")}
            maxLength={120}
            required
          />
        </PanelDialog.Section>
        <PanelDialog.Section title="When" subtitle="Run for every incoming message or only when conditions match." icon="ti ti-filter">
          <Select
            label="Incoming messages"
            value={() => scope().mode}
            onValueChange={(mode) => {
              setScopeTouched(true);
              setScope(mode === "all" ? { mode: "all" } : { mode: "matching", conditions: matchingConditions() });
            }}
            options={[
              { id: "all", label: "All incoming mail", icon: "ti ti-mailbox" },
              { id: "matching", label: "Mail matching conditions", icon: "ti ti-filter" },
            ]}
          />
          <Show when={scope().mode === "matching"}>
            <MailAutomationConditionsEditor
              conditions={(scope() as Extract<MailAutomationScope, { mode: "matching" }>).conditions}
              onChange={(conditions) => {
                setScopeTouched(true);
                setMatchingConditions(conditions);
                setScope({ mode: "matching", conditions });
              }}
            />
          </Show>
          <Show when={validationMessage("scope")}>
            {(message) => (
              <p class="text-xs text-red-600 dark:text-red-400" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </PanelDialog.Section>
        <PanelDialog.Section
          title="Flow"
          subtitle="Steps run from top to bottom. AI results are normal outputs that later steps and conditions can use."
          icon="ti ti-route"
        >
          <AutomationStepsEditor steps={steps()} availableActions={[]} catalog={props.catalog} onChange={setSteps} />
          <Show when={validationMessage("steps")}>
            {(message) => (
              <p class="text-xs text-red-600 dark:text-red-400" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </PanelDialog.Section>
        <PanelDialog.Section
          title="Safety"
          subtitle="Review execution scope and enable the automation when it is ready."
          icon="ti ti-shield-check"
        >
          <Show
            when={usesAi()}
            fallback={
              <Switch
                label="Also apply to existing matching mail after saving"
                description="A resumable backfill is previewed before it starts."
                value={applyExisting}
                onValueChange={setApplyExisting}
                disabled={!enabled()}
              />
            }
          >
            <div class="info-block-info flex items-start gap-2">
              <i class="ti ti-sparkles mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                This flow makes up to {maxAiCalls(steps())} AI call{maxAiCalls(steps()) === 1 ? "" : "s"} per matching message. AI flows
                only process future mail. AI can be wrong; reply drafts always remain drafts for human review.
              </span>
            </div>
          </Show>
          <Switch
            label="Automation active"
            value={enabled}
            onValueChange={(value) => {
              setEnabled(value);
              if (!value) setApplyExisting(false);
            }}
          />
          <p class="text-[11px] text-dimmed">
            If a later step fails, effects from completed earlier steps remain. This automation never sends mail automatically.
          </p>
        </PanelDialog.Section>
        <Show when={props.automation?.workflowSource}>
          <PanelDialog.Section
            title="Generated workflow"
            subtitle="This canonical source is regenerated from the guided flow whenever you save."
            icon="ti ti-code"
          >
            <CodeDisplay code={props.automation!.workflowSource} title="Canonical YAML" language="text" lineNumbers={false} />
          </PanelDialog.Section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="min-w-0 flex-1 text-xs text-dimmed">
          {enabled() ? "Applies to newly received messages." : "Saved inactive for review."}
        </span>
        <div class="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={save.loading()} onClick={() => void closeSafely()}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!validation().success || save.loading()} onClick={() => save.mutate()}>
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
            {props.automation ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openIncomingAutomationEditor = (params: {
  mailboxId: string;
  catalog?: MailWorkflowCatalogSnapshot;
  automation?: IncomingAutomation | null;
  preset?: IncomingAutomationPreset;
  initialScope?: MailAutomationScope;
  initialAction?: AutomationActionKind;
  initialName?: string;
  onSaved: (automation: IncomingAutomation) => void;
  onBackfillStarted?: (backfill: IncomingAutomationBackfill) => void;
}) => {
  const open = async () => {
    let catalog = params.catalog;
    if (!catalog) {
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"].catalog.$get({
        param: { mailboxId: params.mailboxId },
      });
      if (!response.ok) {
        await prompts.error(await readApiError(response, "Could not load automation actions"));
        return;
      }
      catalog = await response.json();
    }
    if (params.preset === "ai-draft" && (catalog.senderIdentities ?? []).length === 0) {
      await prompts.error("Verify a sender identity and allow mailbox automation before creating AI reply drafts.");
      return;
    }
    if (params.preset === "ai-tag" && (catalog.localTags ?? []).length < 2) {
      await prompts.error("Create at least two local tags before using AI to add relevant tags.");
      return;
    }
    return dialogCore.open<void>(
      (close) => (
        <IncomingAutomationEditor
          mailboxId={params.mailboxId}
          catalog={catalog}
          automation={params.automation ?? null}
          preset={params.preset ?? "blank"}
          initialScope={params.initialScope}
          initialAction={params.initialAction}
          initialName={params.initialName}
          close={() => close()}
          onSaved={params.onSaved}
          onBackfillStarted={(backfill) => params.onBackfillStarted?.(backfill)}
        />
      ),
      { ...panelDialogWideOptions, cancelBehavior: "ignore" },
    );
  };
  return open();
};

export default function MailIncomingAutomationSettings(props: {
  mailboxId: string;
  catalog: MailWorkflowCatalogSnapshot;
  initialAutomations: IncomingAutomation[];
  openPreset?: IncomingAutomationPreset | null;
  onOpenPresetHandled?: () => void;
}) {
  const [automations, setAutomations] = createSignal(props.initialAutomations);
  const [backfills, setBackfills] = createSignal<Record<string, IncomingAutomationBackfill>>({});
  const [loadedBackfills, setLoadedBackfills] = createSignal<Set<string>>(new Set());
  const upsert = (automation: IncomingAutomation) =>
    setAutomations((current) =>
      [...current.filter((candidate) => candidate.id !== automation.id), automation].sort((a, b) => a.name.localeCompare(b.name)),
    );
  const rememberBackfill = (backfill: IncomingAutomationBackfill) => {
    setBackfills((current) => ({ ...current, [backfill.automationId]: backfill }));
    setLoadedBackfills((current) => new Set(current).add(backfill.automationId));
  };
  const backfillLocksAutomation = (automation: IncomingAutomation): boolean => {
    const backfill = backfills()[automation.id];
    if (automation.latestBackfillOperationId && !loadedBackfills().has(automation.id)) return true;
    return Boolean(backfill && activeBackfillStates.has(backfill.state));
  };

  const toggle = mutation.create<IncomingAutomation, { automation: IncomingAutomation; enabled: boolean }>({
    mutation: async ({ automation, enabled }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].enabled.$patch(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { expectedRevision: automation.revision, enabled },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not change incoming automation"));
      return response.json();
    },
    onSuccess: upsert,
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<IncomingAutomation | null, IncomingAutomation>({
    mutation: async (automation, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        `Delete “${automation.name}”? Future messages will no longer be processed. Existing message changes remain.`,
        { title: "Delete incoming automation?", confirmText: "Delete automation", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].$delete(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { expectedRevision: automation.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not delete incoming automation"));
      return response.json();
    },
    onSuccess: (automation) => {
      if (!automation) return;
      setAutomations((current) => current.filter((candidate) => candidate.id !== automation.id));
      toast.success("Incoming automation deleted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const startBackfill = mutation.create<IncomingAutomationBackfill | null, IncomingAutomation>({
    mutation: async (automation, { abortSignal }) => {
      if (hasAi(automation.steps)) throw new Error("Flows with AI only process future mail");
      const previewResponse = await apiClient.mailboxes[":mailboxId"]["incoming-automations"].preview.$post(
        { param: { mailboxId: props.mailboxId }, json: { scope: automation.scope } },
        { init: { signal: abortSignal } },
      );
      if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview existing messages"));
      const preview = await previewResponse.json();
      if (preview.messageCount === 0) {
        toast("No existing messages match this automation", { title: "Nothing to backfill" });
        return null;
      }
      const confirmed = await prompts.confirm(
        `${preview.messageCount} existing incoming message${preview.messageCount === 1 ? "" : "s"} will be processed. Completed effects remain if a later step fails.`,
        { title: "Apply automation to existing mail?", confirmText: "Start backfill" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].backfills.$post(
        {
          param: { mailboxId: props.mailboxId, automationId: automation.id },
          json: { operationId: crypto.randomUUID(), expectedRevision: automation.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not start backfill"));
      return response.json();
    },
    onSuccess: (backfill) => {
      if (!backfill) return;
      rememberBackfill(backfill);
      toast.success("Backfill started");
    },
    onError: (error) => prompts.error(error.message),
  });

  const cancelBackfill = mutation.create<IncomingAutomationBackfill | null, IncomingAutomationBackfill>({
    mutation: async (backfill, { abortSignal }) => {
      const confirmed = await prompts.confirm("Stop this backfill? Already completed steps remain and you can safely run it again later.", {
        title: "Cancel backfill?",
        confirmText: "Cancel backfill",
        variant: "danger",
      });
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].backfills[":operationId"].$delete(
        {
          param: { mailboxId: props.mailboxId, automationId: backfill.automationId, operationId: backfill.operationId },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not cancel backfill"));
      return response.json();
    },
    onSuccess: (backfill) => {
      if (backfill) rememberBackfill(backfill);
    },
    onError: (error) => prompts.error(error.message),
  });

  let disposed = false;
  let polling = false;
  let restoring = false;
  const refreshBackfills = async () => {
    if (polling) return;
    const active = Object.values(backfills()).filter((backfill) => activeBackfillStates.has(backfill.state));
    if (active.length === 0) return;
    polling = true;
    try {
      const updates = await Promise.all(
        active.map(async (backfill) => {
          const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].backfills[":operationId"].$get({
            param: { mailboxId: props.mailboxId, automationId: backfill.automationId, operationId: backfill.operationId },
          });
          return response.ok ? response.json() : null;
        }),
      );
      for (const update of updates) if (update && !disposed) rememberBackfill(update);
    } catch {
      // Polling is best effort; explicit actions still surface errors.
    } finally {
      polling = false;
    }
  };
  const restoreBackfills = async () => {
    if (restoring) return;
    const pending = props.initialAutomations.filter(
      (automation) => automation.latestBackfillOperationId && !loadedBackfills().has(automation.id),
    );
    if (pending.length === 0) return;
    restoring = true;
    try {
      await Promise.all(
        pending.map(async (automation) => {
          try {
            const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"][":automationId"].backfills[
              ":operationId"
            ].$get({
              param: {
                mailboxId: props.mailboxId,
                automationId: automation.id,
                operationId: automation.latestBackfillOperationId!,
              },
            });
            if (response.ok && !disposed) rememberBackfill(await response.json());
            else if (response.status === 404 && !disposed) setLoadedBackfills((current) => new Set(current).add(automation.id));
          } catch {
            // Keep the automation locked and retry transient failures.
          }
        }),
      );
    } finally {
      restoring = false;
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void restoreBackfills();
    timer = setInterval(() => {
      void restoreBackfills();
      void refreshBackfills();
    }, 1_500);
    if (props.openPreset) {
      void (async () => {
        await waitForMailPageTransition();
        if (disposed) return;
        props.onOpenPresetHandled?.();
        await openIncomingAutomationEditor({
          mailboxId: props.mailboxId,
          catalog: props.catalog,
          preset: props.openPreset ?? "blank",
          onSaved: upsert,
          onBackfillStarted: rememberBackfill,
        });
      })();
    }
  });
  onCleanup(() => {
    disposed = true;
    if (timer) clearInterval(timer);
    toggle.abort();
    remove.abort();
    startBackfill.abort();
    cancelBackfill.abort();
  });

  const columns: DataTableColumn<IncomingAutomation>[] = [
    { id: "name", header: "Automation", value: (automation) => automation.name },
    { id: "scope", header: "When", value: (automation) => scopeLabel(automation.scope) },
    { id: "flow", header: "Flow", value: (automation) => flowLabel(automation, props.catalog) },
    { id: "backfill", header: "Backfill", value: (automation) => backfills()[automation.id]?.state ?? "not_run", cellClass: "w-44" },
    { id: "enabled", header: "Active", value: (automation) => automation.enabled, cellClass: "w-32" },
    { id: "menu", header: "", value: (automation) => automation.id, cellClass: "w-12", headerClass: "w-12" },
  ];

  return (
    <section class="paper overflow-hidden">
      <div class="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div>
          <h2 class="text-xs font-semibold text-primary">Incoming automations</h2>
          <p class="mt-0.5 text-[11px] text-dimmed">
            {automations().length} guided flow{automations().length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          size="sm"
          type="button"
          onClick={() =>
            void openIncomingAutomationEditor({
              mailboxId: props.mailboxId,
              catalog: props.catalog,
              onSaved: upsert,
              onBackfillStarted: rememberBackfill,
            })
          }
        >
          <i class="ti ti-plus" aria-hidden="true" /> Create automation
        </Button>
      </div>
      <DataTable
        rows={automations()}
        columns={columns}
        getRowId={(automation) => automation.id}
        class="overflow-x-auto"
        tableClass={automations().length > 0 ? "w-full min-w-[48rem] text-xs" : "w-full text-xs"}
        hoverRows
        empty="No incoming automations. Create one flow and mix direct mail actions with AI where useful."
        renderCell={({ row, col, render }) => {
          if (col.id === "enabled") {
            return (
              <Switch
                label={
                  <>
                    <span aria-hidden="true">{row.enabled ? "Enabled" : "Disabled"}</span>
                    <span class="sr-only">{`${row.enabled ? "Disable" : "Enable"} ${row.name}`}</span>
                  </>
                }
                value={() => row.enabled}
                disabled={toggle.loading() || backfillLocksAutomation(row)}
                onValueChange={(enabled) => toggle.mutate({ automation: row, enabled })}
              />
            );
          }
          if (col.id === "backfill") {
            if (hasAi(row.steps)) return <span class="text-dimmed">Future only</span>;
            const backfill = backfills()[row.id];
            if (row.latestBackfillOperationId && !loadedBackfills().has(row.id)) return <span class="text-dimmed">Loading…</span>;
            if (row.latestBackfillOperationId && !backfill) return <span class="text-dimmed">History expired</span>;
            if (!backfill) return <span class="text-dimmed">Not run</span>;
            const accepted = backfill.alreadyAcceptedCount + backfill.newlyAcceptedCount;
            if (activeBackfillStates.has(backfill.state)) {
              return <StatusBadge tone="running" label={`Backfill · ${accepted}/${backfill.candidateCount}`} />;
            }
            if (backfill.state === "completed") return <StatusBadge tone="ok" label={`Completed · ${backfill.newlyAcceptedCount} new`} />;
            if (backfill.state === "failed") return <StatusBadge tone="warning" label="Failed" />;
            return <StatusBadge tone="neutral" label="Canceled" />;
          }
          if (col.id === "menu") {
            const backfill = backfills()[row.id];
            const active = backfillLocksAutomation(row);
            return (
              <Dropdown.Root
                position="bottom-left"
                items={[
                  ...(!active
                    ? [
                        {
                          label: "Edit automation",
                          icon: "ti ti-pencil",
                          action: () =>
                            void openIncomingAutomationEditor({
                              mailboxId: props.mailboxId,
                              catalog: props.catalog,
                              automation: row,
                              onSaved: upsert,
                              onBackfillStarted: rememberBackfill,
                            }),
                        },
                      ]
                    : []),
                  ...(row.enabled && !hasAi(row.steps) && !active
                    ? [
                        {
                          label: backfill || row.latestBackfillOperationId ? "Run backfill again" : "Apply to existing mail",
                          icon: "ti ti-database-import",
                          action: () => startBackfill.mutate(row),
                        },
                      ]
                    : []),
                  ...(backfill && active
                    ? [
                        {
                          label: "Cancel backfill",
                          icon: "ti ti-player-stop",
                          variant: "danger" as const,
                          action: () => cancelBackfill.mutate(backfill),
                        },
                      ]
                    : []),
                  ...(!active
                    ? [
                        {
                          label: "Delete automation",
                          icon: "ti ti-trash",
                          variant: "danger" as const,
                          action: () => remove.mutate(row),
                        },
                      ]
                    : []),
                ]}
              >
                <Dropdown.Trigger iconOnly size="sm" type="button" variant="ghost" label={`Actions for ${row.name}`}>
                  <i class="ti ti-dots" aria-hidden="true" />
                </Dropdown.Trigger>
              </Dropdown.Root>
            );
          }
          return render(col.value instanceof Function ? col.value(row) : col.value ? row[col.value] : undefined);
        }}
      />
    </section>
  );
}
