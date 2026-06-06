import { dialogCore, panelDialogOptions, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import type { Contact } from "../../service";
import ContactUpsertForm from "./ContactUpsertForm.island";

type ContactBookOption = {
  id: string;
  name: string;
};

type Props = {
  writableBooks: ContactBookOption[];
  defaultBookId?: string | null;
  buttonClass?: string;
  label?: string;
  variant?: "button" | "icon";
};

export default function CreateContactButton(props: Props) {
  const handleCreateContact = async () => {
    if (props.writableBooks.length === 0) {
      await prompts.alert("You need write access to at least one manual book.", {
        title: "No writable book",
        icon: "ti ti-lock",
      });
      return;
    }

    const defaultBookId =
      props.defaultBookId && props.writableBooks.some((book) => book.id === props.defaultBookId)
        ? props.defaultBookId
        : props.writableBooks[0]!.id;

    const result = await prompts.form({
      title: "Create Contact",
      icon: "ti ti-user-plus",
      confirmText: "Continue",
      fields: {
        bookId: {
          type: "select",
          label: "In which book do you want to create the contact?",
          required: true,
          default: defaultBookId,
          options: props.writableBooks.map((book) => ({
            id: book.id,
            label: book.name,
            icon: "ti ti-cube",
          })),
        },
      },
    });

    if (!result) return;

    const selectedBook = props.writableBooks.find((book) => book.id === result.bookId);
    const created = await dialogCore.open<Contact | undefined>(
      (close) => (
        <ContactUpsertForm
          mode="create"
          bookId={result.bookId}
          title={selectedBook ? `New Contact in ${selectedBook.name}` : "New Contact"}
          icon="ti ti-user-plus"
          onCancel={() => close(undefined)}
          onSaved={(contact) => close(contact)}
        />
      ),
      panelDialogOptions,
    );

    if (!created) return;
    navigateTo(`/app/contacts/${result.bookId}?contact=${created.id}&contactBook=${result.bookId}`);
  };
  const isIcon = () => props.variant === "icon";
  const buttonClass = () =>
    props.buttonClass ?? (isIcon() ? "sidebar-icon-action sidebar-icon-action-success" : "btn-success btn-sm w-full");

  return (
    <button
      type="button"
      class={buttonClass()}
      onClick={handleCreateContact}
      aria-label="Create new contact"
      title={props.label ?? "Create Contact"}
    >
      <i class="ti ti-user-plus" />
      {!isIcon() && (props.label ?? "Create Contact")}
    </button>
  );
}
