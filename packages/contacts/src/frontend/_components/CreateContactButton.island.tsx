import { navigateTo } from "@k2b/ssr/nav";
import { Button } from "@k2b/ui";
import { openContactCreateFlow, type WritableContactBook } from "./ContactCreateFlow";

type Props = {
  writableBooks: WritableContactBook[];
  defaultBookId?: string | null;
  label?: string;
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

  return (
    <Button
      variant="secondary"
      size="sm"
      class="shrink-0"
      onClick={handleCreateContact}
      aria-label="Create new contact"
      title={props.label ?? "New contact"}
    >
      <i class="ti ti-user-plus" aria-hidden="true" />
      {props.label ?? "New contact"}
    </Button>
  );
}
