import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
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
      <div class="flex flex-col gap-2">
        <section class="paper p-4">
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              <i class="ti ti-forms" />
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-primary">Form in edit mode</p>
              <p class="mt-1 text-sm text-dimmed">You are in edit mode. What do you want to do with "{formName}"?</p>
            </div>
            <button type="button" class="icon-btn ml-auto shrink-0" onClick={() => close()} aria-label="Close">
              <i class="ti ti-x" />
            </button>
          </div>
        </section>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            class="paper flex items-center justify-start gap-3 border-blue-400 p-4 text-left text-blue-700 transition hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-500/70 dark:text-blue-300 dark:hover:bg-blue-950/30"
            onClick={() => close("use")}
          >
            <i class="ti ti-send shrink-0" />
            <span class="flex min-w-0 flex-col items-start">
              <span class="font-semibold">Use form</span>
              <span class="text-xs font-normal text-dimmed">Create a record.</span>
            </span>
          </button>
          <button
            type="button"
            class="paper flex items-center justify-start gap-3 border-emerald-400 p-4 text-left text-emerald-700 transition hover:bg-emerald-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/70 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            onClick={() => close("edit")}
          >
            <i class="ti ti-pencil shrink-0" />
            <span class="flex min-w-0 flex-col items-start">
              <span class="font-semibold">Edit form</span>
              <span class="text-xs font-normal text-dimmed">Change settings.</span>
            </span>
          </button>
        </div>
      </div>
    ),
    { surface: "bare", header: false, size: "small" },
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
