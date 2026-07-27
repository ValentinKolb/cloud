import { navigateTo } from "@k2b/ssr/nav";
import { openContactCreateFlow, type WritableContactBook } from "./ContactCreateFlow";

type Props = {
  writableBooks: WritableContactBook[];
  defaultBookId?: string | null;
  buttonClass?: string;
  label?: string;
  variant?: "button" | "icon";
  chooseBook?: boolean;
};

export default function CreateContactButton(props: Props) {
  const handleCreateContact = async () => {
    const result = await openContactCreateFlow({
      writableBooks: props.writableBooks,
      defaultBookId: props.defaultBookId,
      chooseBook: props.chooseBook,
    });
    if (result) navigateTo(`/app/contacts/${result.bookId}?contact=${result.contact.id}&contactBook=${result.bookId}`);
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
