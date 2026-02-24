import { prompts } from "@valentinkolb/cloud/lib/ui";

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

/**
 * Opens the mandatory "select book" flow before creating a contact.
 */
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
    window.location.href = `/app/contacts/${result.bookId}/e`;
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
