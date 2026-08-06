import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  CodeDisplay,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  IconButton,
  NumberInput,
  PanelDialog,
  panelDialogFixedOptions,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  toast,
} from "@k2b/ui";
import { createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
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

type AiOutputStep = Extract<MailAutomationStep, { kind: "ai_generate_text" | "ai_classify" | "ai_classify_many" }>;
export type IncomingAutomationPreset = "blank" | "ai-route" | "ai-tag" | "ai-draft";

const stepId = (): string => crypto.randomUUID();
const choice = (name: string, description: string) => ({ id: stepId(), name, description });
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
const defaultBranchAction = (action?: MailAutomationAction | null): MailAutomationStep =>
  mailActionStep(action ?? { kind: "set_status", status: "needs_action" });
const activeBackfillStates = new Set<IncomingAutomationBackfill["state"]>(["queued", "running", "waiting"]);

const classificationPair = (
  many: boolean,
  catalog: MailWorkflowCatalogSnapshot,
  actions: MailAutomationAction[] = [],
): MailAutomationStep[] => {
  const choices = [
    choice("Important", "Needs personal attention or a timely response"),
    choice("Routine", "Can be handled as routine mail"),
  ];
  const classifier: MailAutomationStep = many
    ? {
        id: stepId(),
        kind: "ai_classify_many",
        instructions: "Choose every category that applies to this message.",
        choices,
        maxChoices: 2,
      }
    : {
        id: stepId(),
        kind: "ai_classify",
        instructions: "Choose the single best category for this message.",
        choices,
      };
  const branchAction = nextMailAction(actions, catalog, branchActionOrder);
  return [
    classifier,
    {
      id: stepId(),
      kind: "branch",
      sourceStepId: classifier.id,
      cases: choices.map((candidate) => ({ choiceId: candidate.id, steps: [defaultBranchAction(branchAction)] })),
      fallback: [],
    },
  ];
};

const draftPair = (catalog: MailWorkflowCatalogSnapshot): MailAutomationStep[] => {
  const text: MailAutomationStep = {
    id: stepId(),
    kind: "ai_generate_text",
    instructions: "Write a concise, helpful reply in the language of the incoming message. Do not invent facts or commitments.",
    maxOutputChars: 4_000,
  };
  const identity = (catalog.senderIdentities ?? [])[0];
  return identity ? [text, { id: stepId(), kind: "create_reply_draft", sourceStepId: text.id, senderIdentityId: identity.id }] : [text];
};

const presetSteps = (preset: IncomingAutomationPreset, catalog: MailWorkflowCatalogSnapshot): MailAutomationStep[] => {
  if (preset === "ai-route") return classificationPair(false, catalog);
  if (preset === "ai-tag") {
    const tags = (catalog.localTags ?? []).slice(0, 4);
    if (tags.length >= 2) {
      const choices = tags.map((tag) => choice(tag.name, `The message belongs to the ${tag.name} category`));
      const classifier: MailAutomationStep = {
        id: stepId(),
        kind: "ai_classify_many",
        instructions: "Choose every matching tag for this message.",
        choices,
        maxChoices: Math.min(3, choices.length),
      };
      return [
        classifier,
        {
          id: stepId(),
          kind: "branch",
          sourceStepId: classifier.id,
          cases: choices.map((candidate, index) => ({
            choiceId: candidate.id,
            steps: [mailActionStep({ kind: "add_local_tag", tagId: tags[index]!.id })],
          })),
          fallback: [],
        },
      ];
    }
    return classificationPair(true, catalog);
  }
  if (preset === "ai-draft") return draftPair(catalog);
  return [mailActionStep(initialMailAutomationAction("mark_read", catalog))];
};

const outputLabel = (step: AiOutputStep): string => {
  if (step.kind === "ai_generate_text") return "AI text";
  return step.kind === "ai_classify" ? "AI classification" : "AI multi-classification";
};

const flattenSteps = (steps: readonly MailAutomationStep[]): MailAutomationStep[] =>
  steps.flatMap((step) =>
    step.kind === "branch"
      ? [step, ...step.cases.flatMap((branchCase) => flattenSteps(branchCase.steps)), ...flattenSteps(step.fallback)]
      : [step],
  );

const directlyDependsOn = (step: MailAutomationStep, sourceStepId: string): boolean =>
  (step.kind === "branch" || step.kind === "create_reply_draft") && step.sourceStepId === sourceStepId;

const stepDependsOn = (step: MailAutomationStep, sourceStepId: string): boolean =>
  directlyDependsOn(step, sourceStepId)
    ? true
    : step.kind === "branch"
      ? [...step.cases.flatMap((branchCase) => branchCase.steps), ...step.fallback].some((candidate) =>
          stepDependsOn(candidate, sourceStepId),
        )
      : false;

const removeStepAndDependents = (steps: MailAutomationStep[], stepIdToRemove: string): MailAutomationStep[] =>
  steps.flatMap((step): MailAutomationStep[] => {
    if (step.id === stepIdToRemove || directlyDependsOn(step, stepIdToRemove)) return [];
    if (step.kind !== "branch") return [step];
    return [
      {
        ...step,
        cases: step.cases.map((branchCase) => ({
          ...branchCase,
          steps: removeStepAndDependents(branchCase.steps, stepIdToRemove),
        })),
        fallback: removeStepAndDependents(step.fallback, stepIdToRemove),
      },
    ];
  });

const hasAi = (steps: readonly MailAutomationStep[]): boolean => flattenSteps(steps).some((step) => step.kind.startsWith("ai_"));
const aiCallCount = (steps: readonly MailAutomationStep[]): number =>
  flattenSteps(steps).filter((step) => step.kind.startsWith("ai_")).length;
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
  const replace = (index: number, patch: { name?: string; description?: string }) =>
    props.onChange({
      ...props.step,
      choices: props.step.choices.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, ...patch } : candidate)),
    });
  return (
    <div class="flex flex-col gap-2">
      <Index each={props.step.choices}>
        {(candidate, index) => (
          <div class="grid gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] p-2 md:grid-cols-[minmax(8rem,0.6fr)_minmax(12rem,1fr)_auto]">
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
                label={`Remove choice ${index + 1}`}
                disabled={props.step.choices.length <= 2}
                onClick={() => remove(index)}
              >
                <i class="ti ti-x" aria-hidden="true" />
              </IconButton>
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
  availableOutputs: AiOutputStep[];
  availableActions: MailAutomationAction[];
  catalog: MailWorkflowCatalogSnapshot;
  allowEmpty?: boolean;
  maxSteps?: number;
  onChange: (steps: MailAutomationStep[]) => void;
}) {
  const outputsBefore = (index: number): AiOutputStep[] => [
    ...props.availableOutputs,
    ...props.steps
      .slice(0, index)
      .filter(
        (step): step is AiOutputStep => step.kind === "ai_generate_text" || step.kind === "ai_classify" || step.kind === "ai_classify_many",
      ),
  ];
  const actionsBefore = (index: number): MailAutomationAction[] => [
    ...props.availableActions,
    ...flattenSteps(props.steps.slice(0, index)).flatMap((step) => (step.kind === "mail_action" ? [step.action] : [])),
  ];
  const syncBranches = (
    steps: MailAutomationStep[],
    source: Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }>,
    branchAction: MailAutomationAction | null,
  ): MailAutomationStep[] =>
    steps.map((candidate) => {
      if (candidate.kind !== "branch") return candidate;
      const nested = {
        ...candidate,
        cases: candidate.cases.map((branchCase) => ({ ...branchCase, steps: syncBranches(branchCase.steps, source, branchAction) })),
        fallback: syncBranches(candidate.fallback, source, branchAction),
      };
      if (candidate.sourceStepId !== source.id) return nested;
      return {
        ...nested,
        cases: source.choices.map(
          (item) =>
            nested.cases.find((branchCase) => branchCase.choiceId === item.id) ?? {
              choiceId: item.id,
              steps: [defaultBranchAction(branchAction)],
            },
        ),
      };
    });
  const replace = (index: number, step: MailAutomationStep) => {
    let next = props.steps.map((candidate, candidateIndex) => (candidateIndex === index ? step : candidate));
    if (step.kind === "ai_classify" || step.kind === "ai_classify_many") {
      next = syncBranches(next, step, nextMailAction(actionsBefore(index), props.catalog, branchActionOrder));
    }
    props.onChange(next);
  };
  const remove = (index: number) => {
    const removed = props.steps[index];
    if (!removed) return;
    props.onChange(removeStepAndDependents(props.steps, removed.id));
  };
  const canMove = (index: number, offset: -1 | 1): boolean => {
    const destination = index + offset;
    const step = props.steps[index];
    const crossed = props.steps[destination];
    return Boolean(step && crossed && !stepDependsOn(step, crossed.id) && !stepDependsOn(crossed, step.id));
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (!canMove(index, offset)) return;
    const next = [...props.steps];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    props.onChange(next);
  };
  const append = (newSteps: MailAutomationStep[]) => props.onChange([...props.steps, ...newSteps]);
  const addItems = () => {
    const remaining = (props.maxSteps ?? 20) - props.steps.length;
    const outputs = outputsBefore(props.steps.length);
    const actions = actionsBefore(props.steps.length);
    const nextAction = nextMailAction(actions, props.catalog, directActionOrder);
    const nextBranchAction = nextMailAction(actions, props.catalog, branchActionOrder);
    const textOutputs = outputs.filter(
      (step): step is Extract<MailAutomationStep, { kind: "ai_generate_text" }> => step.kind === "ai_generate_text",
    );
    return [
      ...(nextAction
        ? [
            {
              label: `Mail action · ${mailAutomationActionKindLabels[nextAction.kind]}`,
              icon: "ti ti-mail-forward",
              action: () => append([mailActionStep(nextAction)]),
            },
          ]
        : []),
      {
        label: "AI generate text",
        icon: "ti ti-sparkles",
        action: () =>
          append([
            {
              id: stepId(),
              kind: "ai_generate_text",
              instructions: "Create useful text from this incoming message.",
              maxOutputChars: 4_000,
            },
          ]),
      },
      ...(nextBranchAction && remaining >= 2
        ? [
            {
              label: "AI classify",
              icon: "ti ti-list-check",
              action: () => append(classificationPair(false, props.catalog, actions)),
            },
            {
              label: "AI classify many",
              icon: "ti ti-tags",
              action: () => append(classificationPair(true, props.catalog, actions)),
            },
          ]
        : []),
      ...(textOutputs.length > 0 && (props.catalog.senderIdentities ?? []).length > 0
        ? [
            {
              label: "Create reply draft from AI text",
              icon: "ti ti-mail-pencil",
              action: () =>
                append([
                  {
                    id: stepId(),
                    kind: "create_reply_draft" as const,
                    sourceStepId: textOutputs.at(-1)!.id,
                    senderIdentityId: (props.catalog.senderIdentities ?? [])[0]!.id,
                  },
                ]),
            },
          ]
        : []),
    ];
  };

  return (
    <div class="flex flex-col gap-2">
      <For each={props.steps}>
        {(step, index) => {
          const outputs = () => outputsBefore(index());
          const actions = () => actionsBefore(index());
          const classifiers = () =>
            outputs().filter(
              (candidate): candidate is Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }> =>
                candidate.kind === "ai_classify" || candidate.kind === "ai_classify_many",
            );
          const textOutputs = () =>
            outputs().filter(
              (candidate): candidate is Extract<MailAutomationStep, { kind: "ai_generate_text" }> => candidate.kind === "ai_generate_text",
            );
          return (
            <div class="relative rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-3">
              <div class="mb-3 flex items-center gap-2">
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface)] text-[11px] font-semibold text-dimmed">
                  {index() + 1}
                </span>
                <strong class="min-w-0 flex-1 text-xs text-primary">
                  {step.kind === "mail_action"
                    ? "Mail action"
                    : step.kind === "ai_generate_text"
                      ? "AI generate text"
                      : step.kind === "ai_classify"
                        ? "AI classify"
                        : step.kind === "ai_classify_many"
                          ? "AI classify many"
                          : step.kind === "branch"
                            ? "Branch"
                            : "Create reply draft"}
                </strong>
                <Show when={step.kind.startsWith("ai_")}>
                  <StatusBadge tone="neutral" label="AI call" />
                </Show>
                <IconButton type="button" size="sm" label="Move step up" disabled={!canMove(index(), -1)} onClick={() => move(index(), -1)}>
                  <i class="ti ti-arrow-up" aria-hidden="true" />
                </IconButton>
                <IconButton type="button" size="sm" label="Move step down" disabled={!canMove(index(), 1)} onClick={() => move(index(), 1)}>
                  <i class="ti ti-arrow-down" aria-hidden="true" />
                </IconButton>
                <IconButton
                  type="button"
                  size="sm"
                  label="Remove step"
                  disabled={!props.allowEmpty && props.steps.length === 1}
                  onClick={() => remove(index())}
                >
                  <i class="ti ti-x" aria-hidden="true" />
                </IconButton>
              </div>

              <Show when={step.kind === "mail_action"}>
                <MailAutomationActionEditor
                  action={(step as Extract<MailAutomationStep, { kind: "mail_action" }>).action}
                  otherActions={actions()}
                  catalog={props.catalog}
                  onChange={(action) => replace(index(), { ...step, kind: "mail_action", action })}
                />
              </Show>

              <Show when={step.kind === "ai_generate_text"}>
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
              </Show>

              <Show when={step.kind === "ai_classify" || step.kind === "ai_classify_many"}>
                <div class="flex flex-col gap-3">
                  <TextInput
                    label="Instructions"
                    description="Define the classification goal. Choice descriptions below define the decision boundary."
                    value={() => (step.kind === "ai_classify" || step.kind === "ai_classify_many" ? step.instructions : "")}
                    onValueChange={(instructions) =>
                      (step.kind === "ai_classify" || step.kind === "ai_classify_many") && replace(index(), { ...step, instructions })
                    }
                    maxLength={4_000}
                    multiline
                    lines={2}
                    required
                  />
                  <ChoiceEditor
                    step={step as Extract<MailAutomationStep, { kind: "ai_classify" | "ai_classify_many" }>}
                    onChange={(next) => replace(index(), next)}
                  />
                  <Show when={step.kind === "ai_classify_many"}>
                    <div class="w-48">
                      <NumberInput
                        label="Maximum matches"
                        value={() => (step.kind === "ai_classify_many" ? step.maxChoices : 1)}
                        onValueChange={(maxChoices) =>
                          step.kind === "ai_classify_many" && replace(index(), { ...step, maxChoices: maxChoices ?? 1 })
                        }
                        min={1}
                        max={step.kind === "ai_classify_many" ? step.choices.length : 1}
                      />
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={step.kind === "branch"}>
                {(() => {
                  const branch = step as Extract<MailAutomationStep, { kind: "branch" }>;
                  const source = () => classifiers().find((candidate) => candidate.id === branch.sourceStepId);
                  return (
                    <div class="flex flex-col gap-3">
                      <Select
                        label="Classification result"
                        value={() => branch.sourceStepId}
                        onValueChange={(sourceStepId) => {
                          const nextSource = classifiers().find((candidate) => candidate.id === sourceStepId);
                          if (!nextSource) return;
                          replace(index(), {
                            ...branch,
                            sourceStepId: nextSource.id,
                            cases: nextSource.choices.map((candidate) => ({
                              choiceId: candidate.id,
                              steps: [defaultBranchAction(nextMailAction(actions(), props.catalog, branchActionOrder))],
                            })),
                          });
                        }}
                        options={classifiers().map((candidate) => ({ id: candidate.id, label: outputLabel(candidate) }))}
                      />
                      <For each={source()?.choices ?? []}>
                        {(candidate) => {
                          const branchCase = () => branch.cases.find((item) => item.choiceId === candidate.id);
                          return (
                            <div class="border-l-2 border-[var(--ui-accent)] pl-3">
                              <div class="mb-2">
                                <strong class="text-xs text-primary">If “{candidate.name}”</strong>
                                <p class="text-[11px] text-dimmed">{candidate.description}</p>
                              </div>
                              <AutomationStepsEditor
                                steps={branchCase()?.steps ?? [defaultBranchAction()]}
                                availableOutputs={outputs()}
                                availableActions={actions()}
                                catalog={props.catalog}
                                maxSteps={12}
                                onChange={(steps) =>
                                  replace(index(), {
                                    ...branch,
                                    cases: branch.cases.map((item) => (item.choiceId === candidate.id ? { ...item, steps } : item)),
                                  })
                                }
                              />
                            </div>
                          );
                        }}
                      </For>
                      <div class="border-l-2 border-[var(--ui-border)] pl-3">
                        <div class="mb-2">
                          <strong class="text-xs text-primary">Otherwise</strong>
                          <p class="text-[11px] text-dimmed">Optional fallback when no choice is returned.</p>
                        </div>
                        <AutomationStepsEditor
                          steps={branch.fallback}
                          availableOutputs={outputs()}
                          availableActions={actions()}
                          catalog={props.catalog}
                          allowEmpty
                          maxSteps={12}
                          onChange={(fallback) => replace(index(), { ...branch, fallback })}
                        />
                      </div>
                    </div>
                  );
                })()}
              </Show>

              <Show when={step.kind === "create_reply_draft"}>
                <div class="grid gap-2 md:grid-cols-2">
                  <Select
                    label="AI text"
                    value={() => (step.kind === "create_reply_draft" ? step.sourceStepId : "")}
                    onValueChange={(sourceStepId) =>
                      step.kind === "create_reply_draft" && replace(index(), { ...step, sourceStepId: sourceStepId ?? "" })
                    }
                    options={textOutputs().map((candidate) => ({ id: candidate.id, label: outputLabel(candidate) }))}
                  />
                  <Select
                    label="From address"
                    value={() => (step.kind === "create_reply_draft" ? step.senderIdentityId : "")}
                    onValueChange={(senderIdentityId) =>
                      step.kind === "create_reply_draft" && replace(index(), { ...step, senderIdentityId: senderIdentityId ?? "" })
                    }
                    options={(props.catalog.senderIdentities ?? []).map((identity) => ({ id: identity.id, label: identity.name }))}
                  />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={props.steps.length < (props.maxSteps ?? 20)}>
        <Dropdown.Root position="bottom-right" width="18rem" items={addItems()}>
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
  const [name, setName] = createSignal(props.automation?.name ?? props.initialName ?? "");
  const [enabled, setEnabled] = createSignal(props.automation?.enabled ?? false);
  const [scope, setScope] = createSignal<MailAutomationScope>(props.automation?.scope ?? props.initialScope ?? { mode: "all" });
  const [steps, setSteps] = createSignal<MailAutomationStep[]>(initialSteps());
  const [applyExisting, setApplyExisting] = createSignal(false);

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
  const validationMessage = () => {
    const result = validation();
    return result.success ? null : (result.error.issues[0]?.message ?? "Complete the automation before saving.");
  };
  const usesAi = () => hasAi(steps());
  onCleanup(() => save.abort());

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.automation ? "Edit incoming automation" : "Create incoming automation"}
        subtitle="Mix mail and AI building blocks in one top-to-bottom flow."
        icon="ti ti-mailbox"
        close={props.close}
        closeDisabled={save.loading()}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Basics"
          subtitle="New automations start inactive so you can review them safely."
          icon="ti ti-adjustments"
        >
          <TextInput label="Name" value={name} onValueChange={setName} maxLength={120} required />
        </PanelDialog.Section>
        <PanelDialog.Section title="When" subtitle="Run for every incoming message or only when conditions match." icon="ti ti-filter">
          <Select
            label="Incoming messages"
            value={() => scope().mode}
            onValueChange={(mode) =>
              setScope(
                mode === "all"
                  ? { mode: "all" }
                  : { mode: "matching", conditions: { mode: "all", items: [initialMailAutomationCondition()] } },
              )
            }
            options={[
              { id: "all", label: "All incoming mail", icon: "ti ti-mailbox" },
              { id: "matching", label: "Mail matching conditions", icon: "ti ti-filter" },
            ]}
          />
          <Show when={scope().mode === "matching"}>
            <MailAutomationConditionsEditor
              conditions={(scope() as Extract<MailAutomationScope, { mode: "matching" }>).conditions}
              onChange={(conditions) => setScope({ mode: "matching", conditions })}
            />
          </Show>
        </PanelDialog.Section>
        <PanelDialog.Section
          title="Flow"
          subtitle="Steps run from top to bottom. Add mail actions and AI blocks wherever they belong; branches can contain both."
          icon="ti ti-route"
        >
          <AutomationStepsEditor steps={steps()} availableOutputs={[]} availableActions={[]} catalog={props.catalog} onChange={setSteps} />
          <Show when={validationMessage()}>
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
                This flow makes up to {aiCallCount(steps())} AI call{aiCallCount(steps()) === 1 ? "" : "s"} per matching message. AI flows
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
          <Button type="button" size="sm" variant="secondary" disabled={save.loading()} onClick={props.close}>
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
      panelDialogFixedOptions,
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
    await Promise.all(
      props.initialAutomations.flatMap((automation) =>
        automation.latestBackfillOperationId
          ? [
              (async () => {
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
                } catch {
                  // Backfill history has bounded retention.
                } finally {
                  if (!disposed) setLoadedBackfills((current) => new Set(current).add(automation.id));
                }
              })(),
            ]
          : [],
      ),
    );
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void restoreBackfills();
    timer = setInterval(() => void refreshBackfills(), 1_500);
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
                label={row.enabled ? "Enabled" : "Disabled"}
                value={() => row.enabled}
                disabled={toggle.loading()}
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
            const active = Boolean(backfill && activeBackfillStates.has(backfill.state));
            return (
              <Dropdown.Root
                position="bottom-left"
                items={[
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
                  {
                    label: "Delete automation",
                    icon: "ti ti-trash",
                    variant: "danger" as const,
                    action: () => remove.mutate(row),
                  },
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
