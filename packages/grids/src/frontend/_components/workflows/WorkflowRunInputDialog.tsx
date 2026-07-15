import { dialogCore, PanelDialog, panelDialogOptions } from "@valentinkolb/cloud/ui";
import { createMemo, createSignal } from "solid-js";
import type { Table, Workflow } from "../../../service";
import { WorkflowInputFields } from "./WorkflowInputFields";
import { buildWorkflowRunInput, type WorkflowRunInputDraft, type WorkflowRunInputDraftValue } from "./workflow-trigger-actions";

type Props = {
  workflow: Workflow;
  tables: Table[];
  mode: "execute" | "dryRun";
  close: (input?: Record<string, unknown>) => void;
};

function WorkflowRunInputDialog(props: Props) {
  const [draft, setDraft] = createSignal<WorkflowRunInputDraft>({});
  const inputs = () => props.workflow.plan.inputs;
  const validation = createMemo(() => buildWorkflowRunInput(inputs(), draft()));
  const setValue = (name: string, next: WorkflowRunInputDraftValue) => setDraft((current) => ({ ...current, [name]: next }));
  const errors = () => {
    const current = validation();
    return current.ok ? {} : current.errors;
  };
  const submit = () => {
    const current = validation();
    if (current.ok) props.close(current.input);
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`${props.mode === "dryRun" ? "Dry run" : "Run"} ${props.workflow.name}`}
        subtitle={props.mode === "dryRun" ? "Provide the inputs for this dry run." : "Provide the inputs for this run."}
        icon={props.mode === "dryRun" ? "ti ti-flask" : "ti ti-player-play"}
        close={() => props.close()}
      />
      <PanelDialog.Body>
        <WorkflowInputFields workflow={props.workflow} tables={props.tables} draft={draft} onValueChange={setValue} errors={errors} />
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => props.close()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!validation().ok} onClick={submit}>
            <i class={props.mode === "dryRun" ? "ti ti-flask" : "ti ti-player-play"} />
            {props.mode === "dryRun" ? "Start dry run" : "Run workflow"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const requestWorkflowRunInput = async (args: {
  workflow: Workflow;
  tables: Table[];
  mode: "execute" | "dryRun";
}): Promise<Record<string, unknown> | undefined> => {
  if (args.workflow.plan.inputs.length === 0) return {};
  return dialogCore.open<Record<string, unknown>>((close) => <WorkflowRunInputDialog {...args} close={close} />, panelDialogOptions);
};
