import { Tooltip } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";

const ADMIN_BUTTON_CLASS = "btn-input-success btn-input-sm";

export function RecordsAdminToolbar(props: {
  savedView: boolean;
  activeViewAvailable: boolean;
  canEditActiveView: boolean;
  hiddenViewColumnCount: number;
  allowForms: boolean;
  formsButtonLabel: string;
  onOpenTableSettings: () => void;
  onAddField: () => void;
  onOpenForms: () => void;
  onOpenTemplates: () => void;
  onOpenViewSettings: () => void;
  onAddViewColumn: () => void;
  onDone: () => void;
}) {
  const viewDisabledReason = () => {
    if (!props.activeViewAvailable) return "This view is no longer available.";
    if (!props.canEditActiveView) return "You don't have permission to edit this view.";
    return "";
  };

  return (
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <Show
        when={props.savedView}
        fallback={
          <>
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenTableSettings}>
              <i class="ti ti-settings" /> General
            </button>
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onAddField}>
              <i class="ti ti-plus" /> Add field
            </button>
            <Show when={props.allowForms}>
              <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenForms}>
                <i class="ti ti-forms" /> {props.formsButtonLabel}
              </button>
            </Show>
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenTemplates}>
              <i class="ti ti-file-type-pdf" /> Templates
            </button>
          </>
        }
      >
        <>
          <Tooltip content={viewDisabledReason()} disabled={!viewDisabledReason()}>
            <span class="inline-flex">
              <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenViewSettings} disabled={Boolean(viewDisabledReason())}>
                <i class="ti ti-table-spark" /> View
              </button>
            </span>
          </Tooltip>
          <Show when={props.hiddenViewColumnCount > 0}>
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onAddViewColumn}>
              <i class="ti ti-plus" /> Add column
            </button>
          </Show>
        </>
      </Show>
      <button type="button" class="btn-simple btn-sm ml-auto" onClick={props.onDone}>
        Done
      </button>
    </div>
  );
}
