import { dialogCore, PanelDialog, panelDialogOptions, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, For, Show } from "solid-js";
import type { AuditRequirement, AuditUpdateRequirement, RecordMutationAudit } from "../../../contracts";

type OpenRecordAuditDialogArgs = {
  operation: "update" | "delete" | "restore";
  requirement: AuditRequirement | AuditUpdateRequirement;
  recordTitle: string;
};

const operationCopy = {
  update: {
    title: "Explain record changes",
    subtitle: "This table requires context for the fields you changed.",
    action: "Save changes",
    icon: "ti ti-pencil",
    actionClass: "btn-primary btn-sm",
  },
  delete: {
    title: "Move record to trash",
    subtitle: "The record remains available in trash and can be restored.",
    action: "Move to trash",
    icon: "ti ti-trash",
    actionClass: "btn-danger btn-sm",
  },
  restore: {
    title: "Restore record",
    subtitle: "The original deletion reason remains unchanged. These answers describe this restore.",
    action: "Restore",
    icon: "ti ti-arrow-back-up",
    actionClass: "btn-primary btn-sm",
  },
} as const;

export const openRecordAuditDialog = (args: OpenRecordAuditDialogArgs): Promise<RecordMutationAudit | null> =>
  dialogCore
    .open<RecordMutationAudit | null>((close) => {
      const copy = operationCopy[args.operation];
      const [answers, setAnswers] = createSignal<Record<string, string>>({});
      const [errors, setErrors] = createSignal<Record<string, string>>({});
      const setAnswer = (questionId: string, value: string) => {
        setAnswers((current) => ({ ...current, [questionId]: value }));
        setErrors((current) => {
          if (!current[questionId]) return current;
          const next = { ...current };
          delete next[questionId];
          return next;
        });
      };
      const submit = () => {
        const nextErrors: Record<string, string> = {};
        for (const question of args.requirement.questions) {
          if (question.required && !answers()[question.id]?.trim()) nextErrors[question.id] = "Required";
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        close({ answers: answers() });
      };

      return (
        <PanelDialog>
          <PanelDialog.Header title={copy.title} subtitle={args.recordTitle} icon={copy.icon} close={() => close(null)} />
          <PanelDialog.Body>
            <p class="text-sm text-secondary">{copy.subtitle}</p>
            <PanelDialog.Section
              title="Audit details"
              subtitle="These answers become part of the permanent record history."
              icon="ti ti-shield-check"
            >
              <For each={args.requirement.questions}>
                {(question) => (
                  <Show
                    when={question.type === "select"}
                    fallback={
                      <TextInput
                        label={question.label}
                        description={question.description}
                        value={() => answers()[question.id] ?? ""}
                        onInput={(value) => setAnswer(question.id, value)}
                        error={() => errors()[question.id]}
                        multiline={question.type === "longtext"}
                        lines={question.type === "longtext" ? 4 : undefined}
                        required={question.required}
                      />
                    }
                  >
                    <SelectInput
                      label={question.label}
                      description={question.description}
                      value={() => answers()[question.id]}
                      onChange={(value) => setAnswer(question.id, value)}
                      error={() => errors()[question.id]}
                      options={question.type === "select" ? question.options.map((option) => ({ id: option.id, label: option.label })) : []}
                      placeholder="Choose an option"
                      clearable={!question.required}
                      required={question.required}
                    />
                  </Show>
                )}
              </For>
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
                Cancel
              </button>
              <button type="button" class={copy.actionClass} onClick={submit}>
                <i class={copy.icon} /> {copy.action}
              </button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions)
    .then((result) => result ?? null);
