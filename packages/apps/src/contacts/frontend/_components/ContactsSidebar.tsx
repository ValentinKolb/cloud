import type { ContactBook } from "../../service";
import CreateContactButton from "./CreateContactButton.island";
import CreateBookButton from "./CreateBookButton.island";

type ContactBookOption = {
  id: string;
  name: string;
};

type Props = {
  books: ContactBook[];
  active: "all" | string;
  adminBookIds?: string[];
  writableBooks: ContactBookOption[];
  defaultCreateBookId?: string | null;
};

/**
 * Contacts sidebar with books and quick create actions.
 */
export default function ContactsSidebar(props: Props) {
  const adminBookIds = props.adminBookIds ?? [];
  const manualBooks = props.books.filter((book) => !book.isSystem);
  const systemBooks = props.books.filter((book) => book.isSystem);

  return (
    <nav class="flex flex-col h-full">
      <h2 class="section-label px-3 pt-3">Books</h2>

      <div class="flex flex-col">
        <div class="px-1 pb-1">
          <CreateContactButton
            writableBooks={props.writableBooks}
            defaultBookId={props.defaultCreateBookId ?? null}
            buttonClass="list-item h-9 w-full mb-2 text-xs font-medium text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
            label="Create Contact"
          />
        </div>

        <a
          href="/app/contacts"
          class={`list-item h-9 ${props.active === "all" ? "list-item-active" : ""}`}
          aria-current={props.active === "all" ? "page" : undefined}
        >
          <span class="flex items-center text-xs gap-2 min-w-0">
            <i class="ti ti-users" />
            <span class="truncate">All Contacts</span>
          </span>
        </a>

        {manualBooks.map((book) => {
          const href = `/app/contacts/${book.id}`;
          const active = props.active === book.id;
          const canManage = adminBookIds.includes(book.id);
          const settingsVisibilityClass = active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

          return (
            <div class={`list-item h-9 pr-2 group text-xs ${active ? "list-item-active" : ""}`}>
              <div class="flex items-center gap-2 min-w-0 w-full">
                <a href={href} class="flex items-center gap-2 min-w-0 flex-1" aria-current={active ? "page" : undefined}>
                  <i class={`ti ${book.isSystem ? "ti-building-community" : "ti-address-book"}`} />
                  <span class="truncate">{book.name}</span>
                </a>

                {canManage && (
                  <a
                    href={`/app/contacts/${book.id}/settings`}
                    class={`shrink-0 leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${settingsVisibilityClass} transition-opacity`}
                    aria-label={`Open settings for ${book.name}`}
                    title="Book settings"
                  >
                    <i class="ti ti-settings text-sm" />
                  </a>
                )}
              </div>
            </div>
          );
        })}

        {systemBooks.map((book) => {
          const href = `/app/contacts/${book.id}`;
          const active = props.active === book.id;

          return (
            <a href={href} class={`list-item text-xs h-9 ${active ? "list-item-active" : ""}`} aria-current={active ? "page" : undefined}>
              <i class="ti ti-building-community" />
              <span class="truncate">{book.name}</span>
            </a>
          );
        })}
      </div>

      <div class="mt-auto p-3">
        <CreateBookButton buttonClass="list-item text-xs h-9 w-full" label="New Book" />
      </div>
    </nav>
  );
}
