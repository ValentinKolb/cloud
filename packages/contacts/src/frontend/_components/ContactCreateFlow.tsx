import { dialogCore, panelDialogOptions, prompts } from "@k2b/ui";
import type { Contact } from "../../service";
import ContactUpsertForm from "./ContactUpsertForm";
import type { ContactUpsertInitialValues } from "./ContactUpsertForm.model";

export type WritableContactBook = {
  id: string;
  name: string;
};

type ContactCreateFlowResult = {
  bookId: string;
  contact: Contact;
};

export const openContactCreateFlow = async (options: {
  writableBooks: WritableContactBook[];
  defaultBookId?: string | null;
  chooseBook?: boolean;
  initialValues?: ContactUpsertInitialValues;
}): Promise<ContactCreateFlowResult | null> => {
  if (options.writableBooks.length === 0) {
    await prompts.alert("You need write access to at least one manual book before you can create a contact.", {
      title: "No writable contact book",
      icon: "ti ti-lock",
    });
    return null;
  }

  const defaultBookId =
    options.defaultBookId && options.writableBooks.some((book) => book.id === options.defaultBookId)
      ? options.defaultBookId
      : options.writableBooks[0]!.id;

  let selectedBookId = defaultBookId;
  if (options.chooseBook && options.writableBooks.length > 1) {
    const result = await prompts.form({
      title: "Choose contact book",
      icon: "ti ti-address-book",
      confirmText: "Continue",
      fields: {
        bookId: {
          type: "select",
          label: "Contact book",
          description: "Choose where the new contact should be stored.",
          required: true,
          default: defaultBookId,
          options: options.writableBooks.map((book) => ({
            id: book.id,
            label: book.name,
            icon: "ti ti-address-book",
          })),
        },
      },
    });
    if (!result) return null;
    selectedBookId = result.bookId;
  }

  const selectedBook = options.writableBooks.find((book) => book.id === selectedBookId);
  const contact = await dialogCore.open<Contact | undefined>(
    (close) => (
      <ContactUpsertForm
        mode="create"
        bookId={selectedBookId}
        initialValues={options.initialValues}
        title={selectedBook ? `New contact in ${selectedBook.name}` : "New contact"}
        icon="ti ti-user-plus"
        onCancel={() => close(undefined)}
        onSaved={(created) => close(created)}
      />
    ),
    panelDialogOptions,
  );

  return contact ? { bookId: selectedBookId, contact } : null;
};
