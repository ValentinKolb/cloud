import {
  CheckboxCard,
  CopyButton,
  dialogCore,
  MultiSelectInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  Tooltip,
  Button,
  IconButton,
} from "@k2b/ui";
import { createSignal, For, Show } from "solid-js";
import {
  type AuditQuestion,
  AuditQuestionSchema,
  type AuditRequirement,
  type AuditUpdateRequirement,
  type TableAuditPolicy,
  TableAuditPolicySchema,
} from "../../../contracts";
import type { Field } from "../../../service";

type Operation = "delete" | "restore" | "update";

const QUESTION_TYPE_OPTIONS = [
  { id: "text", label: "Short text", icon: "ti ti-cursor-text" },
  { id: "longtext", label: "Long text", icon: "ti ti-align-left" },
  { id: "select", label: "Select", icon: "ti ti-list" },
];

const emptyQuestion = (): AuditQuestion => ({
  id: crypto.randomUUID(),
  type: "text",
  label: "",
  required: true,
});

const clonePolicy = (policy: TableAuditPolicy): TableAuditPolicy => structuredClone(policy);

const defaultRequirement = (): AuditRequirement => ({ enabled: false, questions: [] });
const defaultUpdateRequirement = (): AuditUpdateRequirement => ({
  enabled: false,
  questions: [],
  scope: "all",
  fieldIds: [],
});

export const auditPolicySummary = (policy: TableAuditPolicy): string => {
  const enabled = [policy.update, policy.delete, policy.restore].filter((requirement) => requirement?.enabled);
  if (enabled.length === 0) return "No additional audit answers required";
  const questions = enabled.reduce((count, requirement) => count + (requirement?.questions.length ?? 0), 0);
  return `${enabled.length} operation${enabled.length === 1 ? "" : "s"} · ${questions} question${questions === 1 ? "" : "s"}`;
};

const openQuestionDialog = (question: AuditQuestion): Promise<AuditQuestion | null> =>
  dialogCore
    .open<AuditQuestion | null>((close) => {
      const [label, setLabel] = createSignal(question.label);
      const [description, setDescription] = createSignal(question.description ?? "");
      const [type, setType] = createSignal<AuditQuestion["type"]>(question.type);
      const [required, setRequired] = createSignal(question.required);
      const [options, setOptions] = createSignal(
        question.type === "select" ? question.options.map((option) => ({ ...option })) : [{ id: crypto.randomUUID(), label: "" }],
      );

      const updateOption = (id: string, value: string) =>
        setOptions((current) => current.map((option) => (option.id === id ? { ...option, label: value } : option)));

      const save = () => {
        const candidate = {
          id: question.id,
          label: label(),
          description: description().trim() || undefined,
          type: type(),
          required: required(),
          ...(type() === "select" ? { options: options() } : {}),
        };
        const parsed = AuditQuestionSchema.safeParse(candidate);
        if (!parsed.success) {
          prompts.error(parsed.error.issues[0]?.message ?? "Check the audit question.");
          return;
        }
        close(parsed.data);
      };

      return (
        <PanelDialog>
          <PanelDialog.Header
            title={question.label ? "Edit audit question" : "Add audit question"}
            icon="ti ti-message-question"
            close={() => close(null)}
          />
          <PanelDialog.Body>
            <PanelDialog.Section title="Question" subtitle="Shown before the record operation is completed." icon="ti ti-message-question">
              <TextInput label="Label" value={label} onValueChange={setLabel} placeholder="Why is this change needed?" required />
              <TextInput
                label="Guidance"
                value={description}
                onValueChange={setDescription}
                placeholder="Optional context for the person making the change"
                multiline
                lines={2}
              />
              <Select
                label="Answer type"
                value={type}
                onValueChange={(value) => setType(value as AuditQuestion["type"])}
                options={QUESTION_TYPE_OPTIONS}
                required
              />
              <CheckboxCard
                label="Answer required"
                description="The operation cannot continue until this question is answered."
                icon="ti ti-asterisk"
                variant="input"
                value={required}
                onValueChange={setRequired}
              />
            </PanelDialog.Section>

            <Show when={type() === "select"}>
              <PanelDialog.Section title="Options" subtitle="Users choose one of these values." icon="ti ti-list">
                <div class="flex flex-col gap-2">
                  <For each={options()}>
                    {(option, index) => (
                      <div class="flex items-end gap-2">
                        <div class="min-w-0 flex-1">
                          <TextInput
                            label={`Option ${index() + 1}`}
                            value={() => option.label}
                            onValueChange={(value) => updateOption(option.id, value)}
                            placeholder="Option label"
                            required
                          />
                        </div>
                        <Tooltip content="Remove option">
                          <IconButton
                            variant="ghost"
                            size="sm"
                            type="button"
                            class="mb-1 text-dimmed hover:text-red-600"
                            label={`Remove option ${index() + 1}`}
                            disabled={options().length === 1}
                            onClick={() => setOptions((current) => current.filter((candidate) => candidate.id !== option.id))}
                          >
                            <i class="ti ti-trash" />
                          </IconButton>
                        </Tooltip>
                      </div>
                    )}
                  </For>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    class="self-start"
                    onClick={() => setOptions((current) => [...current, { id: crypto.randomUUID(), label: "" }])}
                  >
                    <i class="ti ti-plus" /> Add option
                  </Button>
                </div>
              </PanelDialog.Section>
            </Show>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={save}>
                Save question
              </Button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions)
    .then((result) => result ?? null);

function RequirementQuestions(props: { questions: () => AuditQuestion[]; onChange: (questions: AuditQuestion[]) => void }) {
  const edit = async (question: AuditQuestion) => {
    const updated = await openQuestionDialog(question);
    if (!updated) return;
    props.onChange(props.questions().map((candidate) => (candidate.id === updated.id ? updated : candidate)));
  };
  const add = async () => {
    const question = await openQuestionDialog(emptyQuestion());
    if (question) props.onChange([...props.questions(), question]);
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={props.questions().length === 0}>
        <p class="text-sm text-dimmed">No questions configured.</p>
      </Show>
      <For each={props.questions()}>
        {(question) => (
          <div class="paper flex min-w-0 items-center gap-3 p-2">
            <i
              class={`ti ${question.type === "select" ? "ti-list" : question.type === "longtext" ? "ti-align-left" : "ti-cursor-text"} text-dimmed`}
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-primary">{question.label}</div>
              <div class="text-xs text-dimmed">
                {question.required ? "Required" : "Optional"} · {QUESTION_TYPE_OPTIONS.find((option) => option.id === question.type)?.label}
              </div>
            </div>
            <Tooltip content="Edit question">
              <IconButton variant="ghost" size="sm" type="button" label={`Edit ${question.label}`} onClick={() => void edit(question)}>
                <i class="ti ti-pencil" />
              </IconButton>
            </Tooltip>
            <CopyButton text={question.id} label="Copy ID" variant="ghost" size="sm" />
            <Tooltip content="Remove question">
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                class="text-dimmed hover:text-red-600"
                label={`Remove ${question.label}`}
                onClick={() => props.onChange(props.questions().filter((candidate) => candidate.id !== question.id))}
              >
                <i class="ti ti-trash" />
              </IconButton>
            </Tooltip>
          </div>
        )}
      </For>
      <Button variant="secondary" size="sm" type="button" class="self-start" onClick={() => void add()}>
        <i class="ti ti-plus" /> Add question
      </Button>
    </div>
  );
}

function RequirementEditor(props: {
  operation: Operation;
  requirement: () => AuditRequirement | AuditUpdateRequirement;
  fields: Field[];
  onChange: (requirement: AuditRequirement | AuditUpdateRequirement) => void;
}) {
  const copy = (patch: Partial<AuditRequirement | AuditUpdateRequirement>) =>
    props.onChange({ ...props.requirement(), ...patch } as AuditRequirement | AuditUpdateRequirement);
  const title = () =>
    props.operation === "delete" ? "Move to trash" : props.operation === "restore" ? "Restore from trash" : "Edit record";
  const description = () =>
    props.operation === "delete"
      ? "Collect operation metadata before a record is moved to trash."
      : props.operation === "restore"
        ? "Collect new metadata for the restore event without changing the original deletion reason."
        : "Collect operation metadata when configured fields actually change.";
  const updateRequirement = () => props.requirement() as AuditUpdateRequirement;

  return (
    <PanelDialog.Section
      title={title()}
      subtitle={description()}
      icon={props.operation === "delete" ? "ti ti-trash" : props.operation === "restore" ? "ti ti-arrow-back-up" : "ti ti-pencil"}
    >
      <CheckboxCard
        label="Require audit answers"
        description="The operation is rejected by the backend when required answers are missing."
        icon="ti ti-shield-check"
        variant="input"
        value={() => props.requirement().enabled}
        onValueChange={(enabled) => copy({ enabled })}
      />
      <Show when={props.requirement().enabled}>
        <Show when={props.operation === "update"}>
          <Select
            label="Apply when"
            value={() => updateRequirement().scope}
            onValueChange={(scope) =>
              copy({ scope: scope as "all" | "selected", fieldIds: scope === "all" ? [] : updateRequirement().fieldIds })
            }
            options={[
              { id: "all", label: "Any field changes" },
              { id: "selected", label: "Selected fields change" },
            ]}
          />
          <Show when={updateRequirement().scope === "selected"}>
            <MultiSelectInput
              label="Fields"
              description="Changing at least one selected field requires the questions below."
              value={() => updateRequirement().fieldIds}
              onValueChange={(fieldIds) => copy({ fieldIds })}
              options={props.fields.filter((field) => !field.deletedAt).map((field) => ({ id: field.id, label: field.name }))}
              icon="ti ti-columns"
              clearable
              required
            />
          </Show>
        </Show>
        <RequirementQuestions questions={() => props.requirement().questions} onChange={(questions) => copy({ questions })} />
      </Show>
    </PanelDialog.Section>
  );
}

export const openAuditPolicyDialog = (args: {
  tableName: string;
  fields: Field[];
  value: TableAuditPolicy;
}): Promise<TableAuditPolicy | null> =>
  dialogCore
    .open<TableAuditPolicy | null>((close) => {
      const [policy, setPolicy] = createSignal<TableAuditPolicy>(clonePolicy(args.value));
      const requirement = (operation: Operation): AuditRequirement | AuditUpdateRequirement =>
        policy()[operation] ?? (operation === "update" ? defaultUpdateRequirement() : defaultRequirement());
      const updateRequirement = (operation: Operation, value: AuditRequirement | AuditUpdateRequirement) =>
        setPolicy((current) => ({ ...current, [operation]: value }));

      const save = () => {
        const parsed = TableAuditPolicySchema.safeParse(policy());
        if (!parsed.success) {
          prompts.error(parsed.error.issues[0]?.message ?? "Check the audit requirements.");
          return;
        }
        close(parsed.data);
      };

      return (
        <PanelDialog>
          <PanelDialog.Header title="Audit requirements" subtitle={args.tableName} icon="ti ti-shield-check" close={() => close(null)} />
          <PanelDialog.Body>
            <p class="text-sm text-secondary">
              Ask for structured reasons only on operations where the extra accountability is useful. Answers are stored with that audit
              event and remain readable if labels change later.
            </p>
            <RequirementEditor
              operation="update"
              requirement={() => requirement("update")}
              fields={args.fields}
              onChange={(value) => updateRequirement("update", value)}
            />
            <RequirementEditor
              operation="delete"
              requirement={() => requirement("delete")}
              fields={args.fields}
              onChange={(value) => updateRequirement("delete", value)}
            />
            <RequirementEditor
              operation="restore"
              requirement={() => requirement("restore")}
              fields={args.fields}
              onChange={(value) => updateRequirement("restore", value)}
            />
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={save}>
                Apply
              </Button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions)
    .then((result) => result ?? null);
