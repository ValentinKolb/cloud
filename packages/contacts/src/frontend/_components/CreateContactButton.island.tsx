import { navigateTo, prompts } from "@valentinkolb/cloud/ui";
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
            icon: "ti ti-address-book",
          })),
        },
      },
    });

    if (!result) return;

    const selectedBook = props.writableBooks.find((book) => book.id === result.bookId);
    const created = await prompts.dialog<Contact | undefined>(
      (close) => (
        <ContactUpsertForm mode="create" bookId={result.bookId} onCancel={() => close(undefined)} onSaved={(contact) => close(contact)} />
      ),
      {
        title: selectedBook ? `New Contact in ${selectedBook.name}` : "New Contact",
        icon: "ti ti-user-plus",
        size: "large",
      },
    );

    if (!created) return;
    navigateTo(`/app/contacts/${result.bookId}?contact=${created.id}&contactBook=${result.bookId}`);
  };

  return (
    <button
      type="button"
      class={props.buttonClass ?? "btn-success btn-sm w-full"}
      onClick={handleCreateContact}
      aria-label="Create new contact"
    >
      <i class="ti ti-user-plus" />
      {props.label ?? "Create Contact"}
    </button>
  );
}
