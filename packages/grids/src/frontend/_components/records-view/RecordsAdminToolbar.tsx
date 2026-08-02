import { Button, Tooltip } from "@k2b/ui";
import { Show } from "solid-js";

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
            <Button variant="success" size="sm" onClick={props.onOpenTableSettings}>
              <i class="ti ti-settings" /> General
            </Button>
            <Button variant="success" size="sm" onClick={props.onAddField}>
              <i class="ti ti-plus" /> Add field
            </Button>
            <Show when={props.allowForms}>
              <Button variant="success" size="sm" onClick={props.onOpenForms}>
                <i class="ti ti-forms" /> {props.formsButtonLabel}
              </Button>
            </Show>
            <Button variant="success" size="sm" onClick={props.onOpenTemplates}>
              <i class="ti ti-file-type-pdf" /> Templates
            </Button>
          </>
        }
      >
        <>
          <Tooltip content={viewDisabledReason()} disabled={!viewDisabledReason()}>
            <span class="inline-flex">
              <Button variant="success" size="sm" onClick={props.onOpenViewSettings} disabled={Boolean(viewDisabledReason())}>
                <i class="ti ti-table-spark" /> View
              </Button>
            </span>
          </Tooltip>
          <Show when={props.hiddenViewColumnCount > 0}>
            <Button variant="success" size="sm" onClick={props.onAddViewColumn}>
              <i class="ti ti-plus" /> Add column
            </Button>
          </Show>
        </>
      </Show>
      <Button variant="ghost" size="sm" type="button" class="ml-auto" onClick={props.onDone}>
        Done
      </Button>
    </div>
  );
}
