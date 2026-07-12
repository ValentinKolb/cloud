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
  chooseBook?: boolean;
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

    let selectedBookId = defaultBookId;
    if (props.chooseBook) {
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
            options: props.writableBooks.map((book) => ({
              id: book.id,
              label: book.name,
              icon: "ti ti-address-book",
            })),
          },
        },
      });
      if (!result) return;
      selectedBookId = result.bookId;
    }

    const selectedBook = props.writableBooks.find((book) => book.id === selectedBookId);
    const created = await dialogCore.open<Contact | undefined>(
      (close) => (
        <ContactUpsertForm
          mode="create"
          bookId={selectedBookId}
          title={selectedBook ? `New contact in ${selectedBook.name}` : "New contact"}
          icon="ti ti-user-plus"
          onCancel={() => close(undefined)}
          onSaved={(contact) => close(contact)}
        />
      ),
      panelDialogOptions,
    );

    if (!created) return;
    navigateTo(`/app/contacts/${selectedBookId}?contact=${created.id}&contactBook=${selectedBookId}`);
  };
  const isIcon = () => props.variant === "icon";
  const buttonClass = () => props.buttonClass ?? (isIcon() ? "sidebar-icon-action" : "btn-primary btn-sm w-full");

  return (
    <button
      type="button"
      class={buttonClass()}
      onClick={handleCreateContact}
      aria-label="Create new contact"
      title={props.label ?? "New contact"}
    >
      <i class="ti ti-user-plus" />
      {!isIcon() && (props.label ?? "New contact")}
    </button>
  );
}
