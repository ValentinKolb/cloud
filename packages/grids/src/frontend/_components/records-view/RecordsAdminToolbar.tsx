import { Show } from "solid-js";

const ADMIN_BUTTON_CLASS = "btn-input-success btn-input-sm";

export function RecordsAdminToolbar(props: {
  savedView: boolean;
  activeViewAvailable: boolean;
  canEditActiveView: boolean;
  hiddenViewColumnCount: number;
  formsButtonLabel: string;
  onOpenTableSettings: () => void;
  onAddField: () => void;
  onOpenForms: () => void;
  onOpenTemplates: () => void;
  onOpenViewSettings: () => void;
  onAddViewColumn: () => void;
  onDone: () => void;
}) {
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
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenForms}>
              <i class="ti ti-forms" /> {props.formsButtonLabel}
            </button>
            <button type="button" class={ADMIN_BUTTON_CLASS} onClick={props.onOpenTemplates}>
              <i class="ti ti-file-type-pdf" /> Templates
            </button>
          </>
        }
      >
        <>
          <button
            type="button"
            class={ADMIN_BUTTON_CLASS}
            onClick={props.onOpenViewSettings}
            disabled={!props.activeViewAvailable || !props.canEditActiveView}
          >
            <i class="ti ti-table-spark" /> View
          </button>
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
