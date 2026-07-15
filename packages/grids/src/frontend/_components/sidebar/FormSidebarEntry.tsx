import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import type { Field, Form } from "../../../service";
import { openFormEditorDialog } from "../forms/FormsManager";
import { openFormModal } from "../records/FormSubmitModal";
import SidebarTableMeta from "./SidebarTableMeta";

type Props = {
  form: Form;
  tableName: string;
  editMode?: boolean;
  initialAccessEntries?: AccessEntry[];
  /** All fields on the form's parent table — used by the modal to
   *  render input rows for each user_input entry referenced by the
   *  form config. Pre-fetched server-side so the click is instant. */
  fields: Field[];
  dateConfig?: DateContext;
};

const chooseEditModeAction = (formName: string) =>
  prompts.dialog<"use" | "edit">(
    (close) => (
      <div class="flex flex-col gap-4">
        <p class="text-sm text-dimmed">You are in edit mode. What do you want to do with "{formName}"?</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => close("use")}>
            <i class="ti ti-send" /> Use form
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => close("edit")}>
            <i class="ti ti-pencil" /> Edit form
          </button>
        </div>
      </div>
    ),
    { title: "Form in edit mode", icon: "ti ti-forms", size: "small" },
  );

/**
 * Sidebar row for a single form. Click opens the authenticated submit
 * modal.
 *
 * Lives as its own island file because the records-page is SSR and
 * can't carry an onClick handler directly. We hydrate just this small
 * button — nothing else from the surrounding sidebar — to keep the
 * payload minimal.
 */
export default function FormSidebarEntry(props: Props) {
  const openSubmit = () =>
    openFormModal(props.form, props.fields, {
      onSubmitted: refreshCurrentPath,
      dateConfig: props.dateConfig,
    });

  const openEditor = () =>
    openFormEditorDialog({
      form: props.form,
      tableFields: props.fields,
      initialAccessEntries: props.initialAccessEntries ?? [],
      canManageAccess: true,
      onSaved: refreshCurrentPath,
      onDelete: refreshCurrentPath,
    });

  const handleClick = async () => {
    if (props.editMode) {
      const action = await chooseEditModeAction(props.form.name);
      if (action === "use") void openSubmit();
      if (action === "edit") void openEditor();
      return;
    }
    void openSubmit();
  };

  return (
    <AppWorkspace.SidebarItem
      class={props.editMode ? "text-secondary" : undefined}
      onClick={() => void handleClick()}
      title={`${props.editMode ? "Edit" : "Submit"} ${props.form.name} (table: ${props.tableName})`}
    >
      <AppWorkspace.SidebarItemIcon icon="ti ti-forms" />
      <AppWorkspace.SidebarItemLabel>{props.form.name}</AppWorkspace.SidebarItemLabel>
      <SidebarTableMeta tableName={props.tableName} />
    </AppWorkspace.SidebarItem>
  );
}
