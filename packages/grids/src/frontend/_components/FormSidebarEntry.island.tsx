import type { Field, Form } from "../../service";
import { openFormModal } from "./FormSubmitModal";

type Props = {
  form: Form;
  /** All fields on the form's parent table — used by the modal to
   *  render input rows for each user_input entry referenced by the
   *  form config. Pre-fetched server-side so the click is instant. */
  fields: Field[];
};

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
  return (
    <button
      type="button"
      class="sidebar-item w-full text-left"
      onClick={() => void openFormModal(props.form, props.fields)}
      title={`Submit ${props.form.name}`}
    >
      <i class="ti ti-forms text-sm shrink-0" />
      <span class="truncate min-w-0 flex-1">{props.form.name}</span>
    </button>
  );
}
