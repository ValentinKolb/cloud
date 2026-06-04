import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import type { Field, Form } from "../../../service";
import { openFormEditorDialog } from "../forms/FormsManager";
import { openFormModal } from "../records/FormSubmitModal";

type Props = {
  form: Form;
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
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => close("use")}
          >
            <i class="ti ti-send" /> Use form
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => close("edit")}
          >
            <i class="ti ti-pencil" /> Edit form
          </button>
        </div>
      </div>
    ),
    { title: "Form in edit mode", icon: "ti ti-forms", size: "small" },
  );

/**
 * Sidebar row for a single form. Click opens the authenticated submit
 * modal — visually a regular `sidebar-item` so it lines up with the
 * Tables / Views rows above it.
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
    <button
      type="button"
      class={`sidebar-item w-full text-left ${
        props.editMode
          ? "text-emerald-700 hover:bg-emerald-50/70 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
          : ""
      }`}
      onClick={handleClick}
      title={props.editMode ? `Edit ${props.form.name}` : `Submit ${props.form.name}`}
    >
      <i class="ti ti-forms text-sm shrink-0" />
      <span class="truncate min-w-0 flex-1">{props.form.name}</span>
    </button>
  );
}
