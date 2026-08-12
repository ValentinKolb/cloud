import type { DateContext } from "@k2b/stdlib";
import { AppWorkspace, dialogCore, PanelDialog, panelDialogWideOptions, toast } from "@k2b/ui";
import { createSignal, For, onCleanup } from "solid-js";
import type { Field } from "../../contracts";
import type { PublicRenderableForm } from "../../service/forms";
import FormSubmit from "../_components/forms/PublicFormSubmit.island";
import { invokeCustomAppWorkflow } from "./workflow-action-client";

export type CustomAppRenderedSidebarAction =
  | {
      id: string;
      kind: "form";
      label: string;
      icon?: string;
      tone: "default" | "success" | "danger";
      submitUrl: string;
      form: PublicRenderableForm;
      fields: Field[];
      inlineTargetFields: Record<string, Field[]>;
      dateConfig: DateContext;
    }
  | {
      id: string;
      kind: "workflow";
      label: string;
      icon?: string;
      tone: "default" | "success" | "danger";
      endpoint: string;
      confirm?: string;
    };

export default function SidebarActions(props: { actions: CustomAppRenderedSidebarAction[]; preview?: boolean }) {
  const [pendingId, setPendingId] = createSignal<string | null>(null);
  let controller: AbortController | null = null;
  onCleanup(() => controller?.abort());

  const openForm = (action: Extract<CustomAppRenderedSidebarAction, { kind: "form" }>) => {
    if (props.preview) return;
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog>
          <PanelDialog.Header
            title={action.form.config.title || action.label}
            icon={`ti ti-${action.icon ?? "forms"}`}
            close={() => close()}
          />
          <PanelDialog.Body>
            <FormSubmit
              submitUrl={action.submitUrl}
              form={action.form}
              fields={action.fields}
              inlineTargetFields={action.inlineTargetFields}
              dateConfig={action.dateConfig}
              surface="bare"
              showTitle={false}
            />
          </PanelDialog.Body>
        </PanelDialog>
      ),
      panelDialogWideOptions,
    );
  };

  const invokeWorkflow = async (action: Extract<CustomAppRenderedSidebarAction, { kind: "workflow" }>) => {
    if (props.preview || pendingId() || (action.confirm && !window.confirm(action.confirm))) return;
    setPendingId(action.id);
    controller = new AbortController();
    try {
      const outcome = await invokeCustomAppWorkflow({ endpoint: action.endpoint, signal: controller.signal });
      if (outcome.kind === "success") {
        toast.success(outcome.message);
        window.setTimeout(() => window.location.reload(), 600);
      } else if (outcome.kind === "error") toast.error(outcome.message);
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(cause instanceof Error ? cause.message : "The workflow could not be started.");
    } finally {
      controller = null;
      setPendingId(null);
    }
  };

  return (
    <For each={props.actions}>
      {(action) => (
        <AppWorkspace.SidebarItem
          icon={`ti ti-${action.icon ?? (action.kind === "form" ? "forms" : "bolt")}`}
          tone={action.tone}
          disabled={props.preview || Boolean(pendingId())}
          onClick={() => (action.kind === "form" ? openForm(action) : void invokeWorkflow(action))}
        >
          <AppWorkspace.SidebarItemLabel>{action.label}</AppWorkspace.SidebarItemLabel>
          {pendingId() === action.id ? <AppWorkspace.SidebarItemMeta>Running…</AppWorkspace.SidebarItemMeta> : null}
        </AppWorkspace.SidebarItem>
      )}
    </For>
  );
}
